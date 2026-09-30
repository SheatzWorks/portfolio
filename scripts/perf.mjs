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
const PATHS = ['/', '/creations', '/studio', '/contact'];

const BUDGETS = {
  htmlGzipKb: 20,
  totalJsKb: 15,
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

  const requests = [];
  page.on('response', async (response) => {
    const url = response.url();
    try {
      const headers = response.headers();
      const length = Number(headers['content-length'] ?? 0);
      requests.push({ url, type: headers['content-type'] ?? '', bytes: length });
    } catch {
      /* response may be gone by the time we read it */
    }
  });

  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60_000 });

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

  const row = {
    path,
    htmlGzipKb: null,
    jsKb: kb(total((r) => r.type.includes('javascript'))),
    cssKb: kb(total((r) => r.type.includes('css'))),
    fontKb: kb(total((r) => r.type.includes('font'))),
    imageKb: kb(total((r) => r.type.startsWith('image'))),
    requests: requests.length,
    thirdParty: requests.filter((r) => isThirdParty(r.url)).length,
    ...metrics,
  };

  // gzip the HTML we actually received, for an honest transfer figure.
  try {
    const res = await page.request.get(`${BASE}${path}`);
    const body = await res.body();
    const { gzipSync } = await import('node:zlib');
    row.htmlGzipKb = kb(gzipSync(body, { level: 6 }).length);
  } catch {
    /* ignore */
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
console.log(pad('path', 12) + pad('html gz', 9) + pad('js', 7) + pad('css', 7) + pad('fonts', 8) + pad('imgs', 8) + pad('reqs', 6) + pad('3p', 5) + pad('LCP', 7) + pad('CLS', 8) + 'TTFB');
console.log('-'.repeat(96));
for (const r of results) {
  console.log(
    pad(r.path, 12) +
      pad(`${r.htmlGzipKb}kb`, 9) +
      pad(`${r.jsKb}kb`, 7) +
      pad(`${r.cssKb}kb`, 7) +
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
  ['JavaScript', worst('jsKb'), BUDGETS.totalJsKb, 'kb'],
  ['CSS (raw)', worst('cssKb'), BUDGETS.totalCssGzipKb, 'kb'],
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
