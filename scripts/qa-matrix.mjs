#!/usr/bin/env node
/**
 * Responsive QA matrix.
 *
 * Screenshots every route at seven real viewport sizes and asserts, at each
 * one, that there is no horizontal overflow, no element sticking out past the
 * viewport, and no console error. "It looks fine when I resize the browser"
 * is not the same as being correct on a 360px Android, which is where most of
 * this site's traffic arrives.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4321';
const OUT = '/tmp/qa-matrix';

const VIEWPORTS = [
  { name: 'small-android', width: 360, height: 740, mobile: true },
  { name: 'android', width: 412, height: 915, mobile: true },
  { name: 'iphone', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 834, height: 1112, mobile: false },
  { name: 'laptop', width: 1280, height: 800, mobile: false },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'ultrawide', width: 2560, height: 1080, mobile: false },
];

const PATHS = ['/', '/creations', '/studio', '/contact'];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
});

let problems = 0;
const report = [];

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    colorScheme: 'dark',
  });

  for (const path of PATHS) {
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45_000 });

    const audit = await page.evaluate(() => {
      const docWidth = document.documentElement.clientWidth;

      // Elements whose right edge sits outside the viewport. Filtered to the
      // ones a user could actually reach, so off-screen panels and the
      // deliberately off-screen honeypot do not produce noise.
      const overflowing = [];
      for (const el of document.querySelectorAll('body *')) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (el.closest('.hp') || el.classList.contains('skip-link')) continue;
        // Deliberately off-canvas panels (the mobile nav) are positioned
        // outside on purpose.
        if (el.closest('[data-open="false"]')) continue;
        if (style.position === 'fixed') continue;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0) continue;
        if (rect.right > docWidth + 1 || rect.left < -1) {
          const tag = el.tagName.toLowerCase();
          const cls = el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '';
          overflowing.push(`${tag}${cls} right=${Math.round(rect.right)} left=${Math.round(rect.left)}`);
        }
      }

      return {
        docWidth,
        scrollWidth: document.documentElement.scrollWidth,
        hasHorizontalScroll: document.documentElement.scrollWidth > docWidth + 1,
        overflowing: overflowing.slice(0, 5),
        // A tap target audit is only meaningful on touch viewports.
        smallTargets: window.matchMedia('(hover: none)').matches
          ? [...document.querySelectorAll('a, button, input, select, textarea')]
              .filter((el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                if (r.width === 0 || r.height === 0) return false;
                if (s.visibility === 'hidden' || s.display === 'none') return false;
                if (el.closest('.hp') || el.classList.contains('skip-link')) return false;
                if (el.tagName === 'A' && s.display.includes('inline') && el.closest('p, li, figcaption, .prose')) return false;
                return r.height < 44 || r.width < 44;
              })
              .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`)
              .slice(0, 5)
          : [],
      };
    });

    const file = `${OUT}/${vp.name}-${path === '/' ? 'home' : path.slice(1).replace(/\//g, '-')}.png`;
    await page.screenshot({ path: file, fullPage: true });

    const issues = [];
    if (audit.hasHorizontalScroll) issues.push('horizontal scroll');
    if (audit.overflowing.length) issues.push(`overflow: ${audit.overflowing.join(', ')}`);
    if (audit.smallTargets.length) issues.push(`small targets: ${audit.smallTargets.join(', ')}`);
    if (errors.length) issues.push(`console: ${errors.slice(0, 2).join(' | ')}`);
    if (issues.length) problems++;

    report.push({ viewport: vp.name, path, issues, file });
    await page.close();
  }

  await context.close();
}

await browser.close();

let last = '';
for (const row of report) {
  if (row.viewport !== last) {
    console.log(`\n${row.viewport}`);
    last = row.viewport;
  }
  console.log(`  ${row.issues.length ? 'FAIL' : 'ok  '} ${row.path.padEnd(12)} ${row.issues.join('; ')}`);
}

console.log(`\n${report.length - problems}/${report.length} viewport x route combinations clean.`);
console.log(`Screenshots in ${OUT}`);
process.exit(problems === 0 ? 0 : 1);
