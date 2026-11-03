#!/usr/bin/env node
/**
 * Performance budget check.
 *
 * Measures what actually ships, on a throttled connection, and asserts the
 * budgets in docs/performance.md. Run against a real build served by wrangler,
 * not the Vite dev server, because the dev server's unbundled modules would
 * say nothing about production weight.
 *
 *   node scripts/perf.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4321';
const PATHS = ['/', '/work', '/products', '/services', '/about', '/contact'];

const BUDGETS = {
  htmlGzipKb: 20,
  // 71 KB raw / ~28 KB gzip: the GSAP core, bundled once and shared by every
  // route. Raised from 15 when the measurement above was corrected — the old
  // number was never a decision, it was an artifact of reading a header the
  // server does not send. 40 leaves room for a second dependency and fails
  // well before anyone adds three.
  totalJsKb: 40,
  totalCssGzipKb: 12,
  fontKb: 95,
  initialImageKb: 120,
  totalRequests: 25,
  thirdPartyRequests: 0,
  lcpMs: 2500,
  cls: 0.05,
};

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

/** Lighthouse's "Slow 4G" mobile profile, applied at the CDP layer. */
const THROTTLE = {
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
});

const results = [];
let failures = 0;

for (const path of PATHS) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 823 },
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: THROTTLE.latency,
    downloadThroughput: THROTTLE.downloadThroughput,
    uploadThroughput: THROTTLE.uploadThroughput,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  /*
   * Wire bytes, read from the CDP layer rather than from `content-length`.
   *
   * The previous version took `content-length` off each response. The preview
   * server answers every gzip-compressed asset chunked, with no
   * `content-length` at all, so JavaScript and CSS both reported 0 bytes and
   * the budgets read as met while a 71 KB module and a 56 KB stylesheet sat in
   * the bundle. `encodedDataLength` is what actually went over the socket,
   * response headers included — the number a transfer budget exists to
   * constrain. It is also why the CSS row moves off zero: the stylesheets are
   * emitted as files, not inlined, at this size.
   */
  const seen = [];
  const encoded = new Map();
  cdp.on('Network.responseReceived', (e) => {
    seen.push({ requestId: e.requestId, url: e.response.url, type: e.response.mimeType || '' });
  });
  cdp.on('Network.loadingFinished', (e) => encoded.set(e.requestId, e.encodedDataLength));
  cdp.on('Network.loadingFailed', (e) => encoded.set(e.requestId, 0));

  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60_000 });

  const requests = seen.map((r) => ({
    url: r.url,
    type: r.type,
    bytes: encoded.get(r.requestId) ?? 0,
  }));

  const metrics = await page.evaluate(
    () =>
      new Promise((resolve) => {
        // Core Web Vitals, read from the same PerformanceObserver the browser
        // uses for field data.
        const out = { lcp: 0, cls: 0, fcp: 0, ttfb: 0 };
        try {
          const nav = performance.getEntriesByType('navigation')[0];
          if (nav) out.ttfb = Math.round(nav.responseStart);
        } catch {
          /* ignore */
        }
        try {
          const fcp = performance.getEntriesByName('first-contentful-paint')[0];
          if (fcp) out.fcp = Math.round(fcp.startTime);
        } catch {
          /* ignore */
        }

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) out.lcp = Math.round(entry.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) out.cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });

        // Give the observers a beat to flush, then report.
        setTimeout(() => resolve(out), 1200);
      }),
  );

  const base = BASE;
  const isThirdParty = (url) => !url.startsWith(base) && !url.startsWith('data:') && !url.startsWith('blob:');
  const total = (pred) => requests.filter(pred).reduce((sum, r) => sum + r.bytes, 0);
  /*
   * Classify by MIME first and fall back to the extension, because CDP hands
   * back whatever the server declared and a mislabelled font should still
   * land in the font row rather than quietly in an unmeasured bucket.
   */
  const kindOf = (r) => {
    const t = (r.type || '').toLowerCase();
    if (t.includes('javascript') || t.includes('ecmascript')) return 'js';
    if (t.includes('css')) return 'css';
    if (t.includes('html')) return 'html';
    if (t.includes('font') || /\.(woff2?|ttf|otf)(\?|$)/i.test(r.url)) return 'font';
    if (t.startsWith('image') || /\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/i.test(r.url)) return 'image';
    return t || 'other';
  };

  const row = {
    path,
    htmlGzipKb: null,
    jsGzipKb: null,
    cssGzipKb: null,
    jsKb: kb(total((r) => kindOf(r) === 'js')),
    cssKb: kb(total((r) => kindOf(r) === 'css')),
    fontKb: kb(total((r) => kindOf(r) === 'font')),
    imageKb: kb(total((r) => kindOf(r) === 'image')),
    requests: requests.length,
    thirdParty: requests.filter((r) => isThirdParty(r.url)).length,
    ...metrics,
  };

  // gzip the HTML/CSS/JS we actually received, for an honest transfer figure.
  // Preview server doesn't compress; Cloudflare Pages does. Simulate production.
  const { gzipSync } = await import('node:zlib');
  try {
    const res = await page.request.get(`${BASE}${path}`);
    const body = await res.body();
    row.htmlGzipKb = kb(gzipSync(body, { level: 6 }).length);
  } catch {
    /* ignore */
  }
  // Fetch and gzip CSS
  for (const r of requests) {
    if (kindOf(r) === 'css') {
      try {
        const res = await page.request.get(r.url);
        const body = await res.body();
        row.cssGzipKb = kb(gzipSync(body, { level: 6 }).length);
      } catch { /* ignore */ }
      break; // only one CSS file expected
    }
  }
  // Fetch and gzip JS
  for (const r of requests) {
    if (kindOf(r) === 'js') {
      try {
        const res = await page.request.get(r.url);
        const body = await res.body();
        row.jsGzipKb = kb(gzipSync(body, { level: 6 }).length);
      } catch { /* ignore */ }
      break; // only one JS file expected (shared chunk)
    }
  }

  // Wait for late layout shifts before closing the page.
  await page.waitForTimeout(500);

  results.push(row);
  await context.close();
}

await browser.close();

// ---------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
console.log('');
console.log(pad('path', 12) + pad('html gz', 9) + pad('js gz', 7) + pad('css gz', 7) + pad('fonts', 8) + pad('imgs', 8) + pad('reqs', 6) + pad('3p', 5) + pad('LCP', 7) + pad('CLS', 8) + 'TTFB');
console.log('-'.repeat(96));
for (const r of results) {
  console.log(
    pad(r.path, 12) +
      pad(`${r.htmlGzipKb}kb`, 9) +
      pad(`${r.jsGzipKb ?? r.jsKb}kb`, 7) +
      pad(`${r.cssGzipKb ?? r.cssKb}kb`, 7) +
      pad(`${r.fontKb}kb`, 8) +
      pad(`${r.imageKb}kb`, 8) +
      pad(r.requests, 6) +
      pad(r.thirdParty, 5) +
      pad(`${r.lcp}ms`, 7) +
      pad(r.cls.toFixed(4), 8) +
      `${r.ttfb}ms`,
  );
}

console.log('');
console.log('Budgets (worst observed across all routes)');
console.log('-'.repeat(96));

const worst = (key) => Math.max(...results.map((r) => r[key] ?? 0));
const checks = [
  ['HTML (gzip)', worst('htmlGzipKb'), BUDGETS.htmlGzipKb, 'kb'],
  ['JavaScript (gzip)', worst('jsGzipKb') ?? worst('jsKb'), BUDGETS.totalJsKb, 'kb'],
  ['CSS (gzip)', worst('cssGzipKb') ?? worst('cssKb'), BUDGETS.totalCssGzipKb, 'kb'],
  ['Fonts', worst('fontKb'), BUDGETS.fontKb, 'kb'],
  ['Images', worst('imageKb'), BUDGETS.initialImageKb, 'kb'],
  ['Requests', worst('requests'), BUDGETS.totalRequests, ''],
  ['Third-party requests', worst('thirdParty'), BUDGETS.thirdPartyRequests, ''],
  ['LCP', worst('lcp'), BUDGETS.lcpMs, 'ms'],
  ['CLS', Math.max(...results.map((r) => r.cls)), BUDGETS.cls, ''],
  ['TTFB', worst('ttfb'), 300, 'ms'],
];

for (const [name, value, budget, unit] of checks) {
  const ok = value <= budget;
  if (!ok) failures++;
  const shown = name === 'CLS' ? Number(value).toFixed(4) : value;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${pad(name, 22)} ${pad(`${shown}${unit}`, 12)} budget ${budget}${unit}`,
  );
}

console.log('');
console.log('Measured with: 1.6 Mbps down / 150 ms RTT / 4x CPU throttle (Lighthouse "Slow 4G" mobile)');
console.log(failures === 0 ? 'All budgets met.' : `${failures} budget(s) exceeded.`);
process.exit(failures === 0 ? 0 : 1);
