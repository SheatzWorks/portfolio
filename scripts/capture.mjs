#!/usr/bin/env node
/**
 * Capture worker.
 *
 * The half of the preview pipeline that cannot run in a Cloudflare Worker:
 * rendering a real page in Chromium and deriving optimised image variants with
 * sharp. Both are Node-only capabilities.
 *
 * Run it three ways:
 *
 *   1. Locally, against one URL (the common case):
 *        node scripts/capture.mjs --url https://example.com --slug my-project
 *
 *   2. Locally, draining the D1 job queue:
 *        npm run capture:drain
 *
 *   3. As a long-running service (self-hosted), polling the queue:
 *        node scripts/capture.mjs --serve
 *
 * Storage is R2 through the S3 API, so the same code works against the real
 * bucket or a local MinIO without branching.
 *
 * Video is opt-in with --video. It records a short scroll via the CDP
 * screencast and pipes frames to the SYSTEM ffmpeg, never to Playwright's
 * bundled one: Playwright's recordVideo is hardcoded to VP8 in a libvpx-only
 * build, which renders UI text as noise.
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadDotEnv() {
  const path = new URL('../.dev.vars', import.meta.url);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const dotenv = loadDotEnv();
const env = (key, fallback = '') => process.env[key] ?? dotenv[key] ?? fallback;

const CARD_WIDTHS = [480, 768, 1200, 1600];
const VIEWPORT = { width: 1440, height: 810 };
const SCALE = 2;
const MEDIA_CACHE = 'public, max-age=31536000, immutable';

// Third-party categories that slow a capture down and can photograph a consent
// dialog. This is a performance and determinism measure, not SSRF defence.
const BLOCKED = /doubleclick|googletagmanager|google-analytics|gtag\/js|hotjar|intercom|segment|facebook\.net|cloudflareinsights|vercel\/insights/i;

// ---------------------------------------------------------------------------
// SSRF guard
// Duplicated from src/lib/safe-fetch.ts on purpose: this script runs in Node,
// outside any bundle, and importing across the two runtimes drags the whole
// astro `~/*` alias chain in with it. The two copies are kept honest by
// tests/unit/safe-fetch.test.ts, which exercises the same vectors.
// ---------------------------------------------------------------------------

import ipaddr from 'ipaddr.js';

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.private', '.corp', '.home.arpa'];
const BLOCKED_HOSTS = new Set([
  'localhost', 'metadata.google.internal', 'instance-data', '169.254.169.254',
]);
const BLOCKED_NETWORKS = [
  '127.0.0.0/8', '0.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
  '169.254.0.0/16', '100.64.0.0/10', '::1/128', '::/128', 'fe80::/10', 'fc00::/7', '2001:db8::/32',
].map((c) => ipaddr.parseCIDR(c));

function isBlockedIp(ip) {
  let addr;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return true; // Unparseable input fails closed.
  }
  if (addr.kind() === 'ipv6') {
    const v6 = addr;
    if (v6.isIPv4MappedAddress()) return isBlockedIp(v6.toIPv4Address().toString());
  }
  for (const [net, bits] of BLOCKED_NETWORKS) {
    if (net.kind() !== addr.kind()) continue;
    try {
      if (addr.match(net, bits)) return true;
    } catch { /* kind mismatch */ }
  }
  return addr.range() !== 'unicast';
}

function validateTarget(raw) {
  const url = new URL(String(raw).trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Refusing ${url.protocol} — only http/https.`);
  }
  if (url.username || url.password) throw new Error('Refusing a URL with embedded credentials.');

  // Dev-only escape, see assertPublicHost.
  if (env('ALLOW_LOCAL_CAPTURE') === '1') return { url, host: url.hostname.toLowerCase() };

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) throw new Error(`Refusing internal host: ${host}`);
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new Error(`Refusing internal suffix: ${host}`);
  return { url, host };
}

async function assertPublicHost(host) {
  /*
   * Development escape hatch. Local testing is genuinely useful — you cannot
   * otherwise exercise the capture path against a page you are building — so
   * this exists, but it is opt-in, must be explicit, and prints a warning that
   * cannot be missed. It is NOT a configuration option in wrangler.jsonc and is
   * never read in the deployed Worker.
   */
  if (env('ALLOW_LOCAL_CAPTURE') === '1') {
    console.warn('  !! ALLOW_LOCAL_CAPTURE=1 — SSRF protection is DISABLED for this run.');
    return [host];
  }

  // `lookup(host, { all: true })` is the correct API: `addresses` is not a real
  // method, and lookup honours the system resolver, which is what the browser
  // will use too. EVERY returned address is checked, not just the first: a
  // hostname with both a public A record and a private one is still a threat.
  const { lookup } = await import('node:dns/promises');
  const records = await lookup(host, { all: true, verbatim: false }).catch(() => []);
  if (!records.length) throw new Error(`Could not resolve ${host}.`);

  for (const { address } of records) {
    if (isBlockedIp(address)) {
      throw new Error(`Refusing ${host}: resolves to non-public ${address}.`);
    }
  }
  return records.map((r) => r.address);
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function withBrowser(fn) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--disable-lcd-text',
    ],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function capturePage(browser, url, { wantVideo = false } = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: 'dark',
    // Deterministic rendering: two captures of the same page are identical.
    reducedMotion: 'reduce',
    forcedColors: 'none',
    locale: 'en',
    timezoneId: 'UTC',
  });

  const page = await context.newPage();
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    // Fonts are blocked deliberately: the capture should show the site's real
    // layout with its own webfonts once they resolve, not a reflow mid-shoot.
    if (type === 'media') return route.abort();
    if (BLOCKED.test(route.request().url())) return route.abort();
    return route.continue();
  });

  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  if (response && response.status() >= 400) {
    throw new Error(`Target returned HTTP ${response.status()}.`);
  }

  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(700);

  const screenshot = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });

  let video = null;
  if (wantVideo) {
    video = await recordScrollVideo(page).catch((err) => {
      console.warn(`  video skipped: ${err.message}`);
      return null;
    });
  }

  const framability = await probeFramability(context, url).catch(() => null);

  await context.close();
  return { screenshot, video, framability };
}

/** Reads framing permission by attempting a real navigation and inspecting headers. */
async function probeFramability(context, url) {
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    if (!response) return { framable: false, reason: 'no response' };
    const headers = response.headers();
    const xfo = (headers['x-frame-options'] ?? '').toLowerCase();
    const csp = headers['content-security-policy'] ?? '';
    if (xfo.includes('deny')) return { framable: false, reason: 'x-frame-options: DENY' };
    if (xfo.includes('allow-from')) return { framable: false, reason: 'x-frame-options: ALLOW-FROM' };
    const fa = /frame-ancestors([^;]*)/i.exec(csp);
    if (fa) {
      const v = fa[1].trim().toLowerCase();
      if (v === "'none'") return { framable: false, reason: 'csp frame-ancestors: none' };
      if (v !== '*' && !v.includes("'self'")) {
        return { framable: false, reason: 'csp frame-ancestors: explicit list' };
      }
    }
    return { framable: true, reason: 'no restrictive framing headers' };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Records a short preview video: the initial viewport, then one slow, natural
 * scroll to suggest the page's shape. Built as a portfolio preview, not a
 * screen recording — it never follows the mouse or clicks anything.
 *
 * CDP screencast is variable-rate: an idle page emits nothing. Frames are
 * therefore numbered by wall clock and gaps are back-filled by repeating the
 * previous frame, with `-fps_mode passthrough` so ffmpeg does not silently
 * discard the duplicates.
 */
async function recordScrollVideo(page) {
  const FPS = 24;
  const DURATION_MS = 9000;
  const tmpDir = '/tmp/studio-capture';
  const { mkdirSync, rmSync, createWriteStream, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');

  mkdirSync(tmpDir, { recursive: true });
  const framesDir = join(tmpDir, `frames-${Date.now()}`);
  mkdirSync(framesDir, { recursive: true });

  const queue = [];
  let started = 0;
  let writing = Promise.resolve();
  let index = 0;
  let lastBuffer = null;

  const client = await page.context().newCDPSession(page);
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 82,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1,
  });

  const startedAt = Date.now();

  client.on('Page.screencastFrame', async ({ data, sessionId }) => {
    const buffer = Buffer.from(data, 'base64');
    const expected = Math.floor(((Date.now() - startedAt) / 1000) * FPS);
    try {
      await client.send('Page.screencastFrameAck', { sessionId });
    } catch { /* frame already acked */ }

    // Back-fill from the previous frame so the timeline stays monotonic.
    while (index < expected) {
      const repeat = lastBuffer ?? buffer;
      const n = String(index++).padStart(6, '0');
      queue.push(join(framesDir, `${n}.jpg`));
      writing = writing.then(() => import('node:fs').then((fs) => fs.promises.writeFile(join(framesDir, `${n}.jpg`), repeat)));
    }
    const n = String(index++).padStart(6, '0');
    queue.push(join(framesDir, `${n}.jpg`));
    writing = writing.then(() => import('node:fs').then((fs) => fs.promises.writeFile(join(framesDir, `${n}.jpg`), buffer)));
    lastBuffer = buffer;
  });

  // One slow scroll across the first two viewports. Nothing else moves.
  const totalScroll = await page.evaluate(() => document.body.scrollHeight - window.innerHeight);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), (totalScroll * 0.6 * i) / steps);
    await sleep(DURATION_MS / steps);
  }
  await sleep(600);

  await client.send('Page.stopScreencast').catch(() => {});
  await writing;

  const files = readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).sort();
  if (!files.length) {
    rmSync(framesDir, { recursive: true, force: true });
    throw new Error('screencast produced no frames');
  }

  const listFile = join(tmpDir, `list-${Date.now()}.txt`);
  const { writeFileSync, readFileSync: rf } = await import('node:fs');
  writeFileSync(listFile, files.map((f) => `file '${join(framesDir, f)}'`).join('\n'));

  const outFile = join(tmpDir, `preview-${Date.now()}.mp4`);

  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-an',
      outFile,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', (d) => (stderr += d.toString()));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`))));
    ff.on('error', reject);
  });

  // Intermediates go to /tmp and are removed on both the success and the
  // failure path, so a repeated run cannot fill the disk.
  rmSync(framesDir, { recursive: true, force: true });
  rmSync(listFile, { force: true });

  const bytes = readFileSync(outFile);
  rmSync(outFile, { force: true });
  return bytes;
}

// ---------------------------------------------------------------------------
// Image processing
// ---------------------------------------------------------------------------

function toHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

async function deriveVariants(png, prefix) {
  const meta = await sharp(png).metadata();
  const variants = [];

  let dominant = null;
  try {
    const stats = await sharp(png).resize(32, 32, { fit: 'inside' }).stats();
    dominant = toHex(stats.dominant.r, stats.dominant.g, stats.dominant.b);
  } catch { /* dominant is optional */ }

  for (const width of CARD_WIDTHS) {
    if (meta.width && width > meta.width) continue;
    const height = Math.round((width * (meta.height ?? 1)) / (meta.width ?? width));

    // AVIF only from 768 up: libvips encodes it 10-30x slower than WebP and the
    // saving below 768 does not justify it.
    if (width >= 768) {
      try {
        const body = await sharp(png)
          .resize(width, height, { fit: 'cover' })
          .avif({ quality: 52, effort: 4, chromaSubsampling: '4:2:0' })
          .toBuffer();
        variants.push({ key: `${prefix}/card-${width}.avif`, body, contentType: 'image/avif' });
      } catch (e) {
        console.warn(`  avif ${width} failed: ${e.message}`);
      }
    }

    const body = await sharp(png)
      .resize(width, height, { fit: 'cover' })
      .webp({ quality: 74, effort: 4 })
      .toBuffer();
    variants.push({ key: `${prefix}/card-${width}.webp`, body, contentType: 'image/webp' });
  }

  const poster = await sharp(png)
    .resize(1200, null, { fit: 'inside' })
    .webp({ quality: 70 })
    .toBuffer();

  return {
    variants,
    poster: { key: `${prefix}/poster.webp`, body: poster, contentType: 'image/webp' },
    dominant,
    width: meta.width ?? VIEWPORT.width,
    height: meta.height ?? VIEWPORT.height,
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function makeS3() {
  const endpoint = env('R2_ENDPOINT');
  const accessKeyId = env('R2_ACCESS_KEY_ID');
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.warn('! R2 credentials not set — variants will be written to ./captures/ instead.');
    return null;
  }
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function upload(s3, key, body, contentType) {
  if (!s3) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const path = join('captures', key);
    mkdirSync(path.split('/').slice(0, -1).join('/'), { recursive: true });
    writeFileSync(path, body);
    return;
  }
  await s3.send(new PutObjectCommand({
    Bucket: env('R2_BUCKET', 'studio-media'),
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: MEDIA_CACHE,
  }));
}

// ---------------------------------------------------------------------------
// D1 (via the Cloudflare REST API — no wrangler needed at runtime)
// ---------------------------------------------------------------------------

async function d1(query, params = []) {
  const account = env('CF_ACCOUNT_ID');
  const token = env('CF_API_TOKEN');
  const dbId = env('CF_D1_DATABASE_ID');
  if (!account || !token || !dbId) throw new Error('CF_ACCOUNT_ID / CF_API_TOKEN / CF_D1_DATABASE_ID are required.');

  const sql = params.reduce((acc, p, i) => acc.replace(`?${i + 1}`, `'${String(p).replace(/'/g, "''")}'`), query);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql }),
    },
  );
  const data = await response.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message ?? 'D1 query failed');
  return data.result?.[0]?.results ?? [];
}

const { join } = await import('node:path');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

async function runOne(s3, { url, slug, wantVideo }) {
  const { url: safeUrl, host } = validateTarget(url);
  console.log(`→ ${safeUrl}`);

  const addresses = await assertPublicHost(host);
  console.log(`  host ${host} → ${addresses.join(', ')} (public)`);

  const { screenshot, video, framability } = await withBrowser((browser) =>
    capturePage(browser, safeUrl.toString(), { wantVideo }),
  );
  console.log(`  captured ${(screenshot.length / 1024).toFixed(0)} KB raw`);

  const prefix = `projects/${slug}`;
  const { variants, poster, dominant, width, height } = await deriveVariants(screenshot, prefix);

  for (const v of variants) {
    await upload(s3, v.key, v.body, v.contentType);
  }
  await upload(s3, poster.key, poster.body, poster.contentType);
  console.log(`  ${variants.length + 1} variants uploaded`);

  let videoAsset = null;
  if (video) {
    videoAsset = { key: `${prefix}/preview.mp4`, body: video, contentType: 'video/mp4' };
    await upload(s3, videoAsset.key, videoAsset.body, videoAsset.contentType);
    console.log(`  video ${(video.length / 1024).toFixed(0)} KB uploaded`);
  }

  return { variants, poster, dominant, width, height, video: videoAsset, framability };
}

async function recordToDatabase(slug, assets) {
  const rows = await d1('SELECT id, preview FROM projects WHERE slug = ?1', [slug]);
  if (!rows.length) throw new Error(`No project with slug "${slug}".`);
  const id = rows[0].id;

  let existing = {};
  try { existing = JSON.parse(rows[0].preview || '{}'); } catch { existing = {}; }

  const primary = assets.variants.find((v) => v.key.endsWith('card-768.webp')) ?? assets.variants[0];
  const next = {
    ...existing,
    thumb: primary.key,
    thumbSrcset: assets.variants.filter((v) => v.key.endsWith('.webp')).map((v) => v.key),
    poster: assets.poster.key,
    dominant: assets.dominant ?? existing.dominant,
    width: assets.width,
    height: assets.height,
    source: 'screenshot',
    frameable: assets.framability?.framable ?? existing.frameable,
    checkedAt: new Date().toISOString(),
    note: assets.framability?.reason,
  };
  if (assets.video) next.video = assets.video.key;

  await d1('UPDATE projects SET preview = ?1, preview_state = ?2 WHERE id = ?3', [
    JSON.stringify(next),
    'ready',
    id,
  ]);
  console.log(`  recorded on project #${id}`);
}

async function drainQueue(s3, { wantVideo }) {
  const rows = await d1(
    `SELECT j.id AS job_id, p.slug, p.url FROM jobs j
       JOIN projects p ON p.id = j.project_id
      WHERE j.state = 'pending' AND p.preview_state != 'ready'
      ORDER BY j.run_after LIMIT 3`,
  );
  if (!rows.length) {
    console.log('No pending capture jobs.');
    return 0;
  }
  for (const row of rows) {
    try {
      const assets = await runOne(s3, { url: row.url, slug: row.slug, wantVideo });
      await recordToDatabase(row.slug, assets);
      await d1(`UPDATE jobs SET state = 'done' WHERE id = ?1`, [row.job_id]);
    } catch (err) {
      console.error(`  failed: ${err.message}`);
      await d1(`UPDATE jobs SET state = 'failed', last_error = ?2 WHERE id = ?1`, [row.job_id, err.message.slice(0, 400)]);
    }
  }
  return rows.length;
}

const args = parseArgs(process.argv.slice(2));
const s3 = makeS3();

try {
  if (args.serve) {
    console.log('Capture service started. Polling every 60s. Ctrl-C to stop.');
    for (;;) {
      try { await drainQueue(s3, { wantVideo: Boolean(args.video) }); } catch (e) { console.error(e.message); }
      await sleep(60_000);
    }
  } else if (args.url && args.slug) {
    const assets = await runOne(s3, { url: args.url, slug: args.slug, wantVideo: Boolean(args.video) });
    if (!args['no-db']) await recordToDatabase(args.slug, assets);
  } else if (args.drain) {
    await drainQueue(s3, { wantVideo: Boolean(args.video) });
  } else {
    console.log(`Usage:
  node scripts/capture.mjs --url https://example.com --slug my-project [--video] [--no-db]
  node scripts/capture.mjs --drain [--video]
  node scripts/capture.mjs --serve [--video]

Environment (.dev.vars or the shell):
  R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
  CF_ACCOUNT_ID, CF_API_TOKEN, CF_D1_DATABASE_ID   (only for --drain/--serve)
  ALLOWED_CAPTURE_HOSTS                            (comma-separated; omit to rely on filtering)`);
  }
} catch (err) {
  console.error(`\nCapture failed: ${err.message}`);
  process.exit(1);
}
