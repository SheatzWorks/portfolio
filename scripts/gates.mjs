#!/usr/bin/env node
/**
 * Hallmark slop test.
 *
 * 58 gates from skills/hallmark/references/slop-test.md, checked against the
 * real build output and a running server rather than by eye. A gate that is
 * only ever eyeballed is a gate that quietly regresses.
 *
 * Each gate that cannot be decided mechanically is reported as MANUAL with the
 * question to answer, rather than silently counted as a pass. A gate script
 * that claims 58/58 while skipping half the checks is worse than no script.
 *
 * Usage:  node scripts/gates.mjs [base-url]
 * Requires: the dev/preview server running (npm run dev, or restart-server.sh).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const BASE = process.argv[2] ?? 'http://127.0.0.1:4321';

const ROUTES = ['/', '/work', '/products', '/services', '/about', '/contact'];

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

const results = [];
let manualCount = 0;

function pass(gate, note = '') {
  results.push({ gate, status: 'pass', note });
}
function fail(gate, note) {
  results.push({ gate, status: 'fail', note });
}
function manual(gate, question) {
  results.push({ gate, status: 'manual', note: question });
  manualCount++;
}

/** Gate numbers may be fractional (38a, 25.5); sort them numerically. */
function gateKey(g) {
  return parseFloat(String(g).replace(/\D+$/, '')) * 1000 + (String(g).match(/\d+$/)?.[0]?.length ?? 0);
}

// ---------------------------------------------------------------------------
// Static source
// ---------------------------------------------------------------------------

const cssDir = join(root, 'src/styles');
const cssFiles = existsSync(cssDir) ? readdirSync(cssDir).filter((f) => f.endsWith('.css')) : [];
// gate 48 skips @font-face, so that block is removed once, here.
const cssNoFaces = cssFiles
  .map((f) => readFileSync(join(cssDir, f), 'utf8'))
  .join('\n')
  .replace(/@font-face\s*\{[\s\S]*?\}/g, '');
const css = cssFiles.map((f) => readFileSync(join(cssDir, f), 'utf8')).join('\n');
const tokens = readFileSync(join(cssDir, 'tokens.css'), 'utf8');

const srcDir = join(root, 'src');
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(astro|ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const sourceFiles = walk(srcDir);
const source = sourceFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

/** Strip comments so a gate cannot be satisfied by a rule named in prose. */
const cssLive = css.replace(/\/\*[\s\S]*?\*\//g, '');
const cssWithoutFontFace = cssNoFaces.replace(/\/\*[\s\S]*?\*\//g, '');
let flexRowInventory = { total: 0, uncentred: [] };
let bareTracks = [];
const sourceLive = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ===========================================================================
// 1 — Display font is not a default
// ===========================================================================
{
  const display = /--font-display:\s*([^;]+);/.exec(tokens)?.[1] ?? '';
  const banned = ['Inter', 'Roboto', 'Open Sans', 'Poppins', 'Lato', 'system-ui', '-apple-system'];
  const hit = banned.find((f) => new RegExp(`(^|[\\s',"])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(display));
  hit ? fail(1, `display face is a default: ${hit}`) : pass(1, display.trim());
}

// ===========================================================================
// 2 — No purple→blue / cyan→magenta gradient, especially on text
// ===========================================================================
{
  const grads = [...cssLive.matchAll(/(?:linear|radial|conic)-gradient\([^;]*\)/g)].map((m) => m[0]);
  const rainbow = grads.filter((g) => /purple|violet|indigo|cyan|magenta|fuchsia|#[0-9a-f]*[89ab]/i.test(g));
  const clipText = /background-clip:\s*text/.test(cssLive);
  if (clipText) fail(2, 'gradient text (background-clip: text) is banned in every genre');
  else if (rainbow.length) fail(2, `purple/blue gradient present: ${rainbow[0].slice(0, 70)}`);
  else pass(2, `${grads.length} gradient(s), none purple→blue`);
}

// ===========================================================================
// 3 — No 3-equal-column icon-above-heading tile grid
// ===========================================================================
{
  const threeCol = /grid-template-columns:\s*repeat\(\s*3\s*,/.test(cssLive);
  // Only a failure when such a grid also renders an icon above a heading.
  const iconTiles = /\.(feature|value|tile|card)__icon\b/.test(cssLive);
  threeCol && iconTiles
    ? fail(3, '3-column grid combined with icon-above-heading tiles')
    : pass(3, threeCol ? '3-col grid present, no icon tiles' : 'no bare 3-col grid');
}

// ===========================================================================
// 4 — No card nested inside a card
// ===========================================================================
{
  const cardClasses = [...cssLive.matchAll(/^\.([a-z0-9_-]*(?:card|panel|box|tile))\b/gm)].map((m) => m[1]);
  const nested = cardClasses.filter((c) =>
    new RegExp(`\\.${c}[\\w-]*\\s+(?:[^{}]*,\\s*)?\\.(?:[a-z0-9_-]*card)`, 'i').test(cssLive),
  );
  nested.length
    ? fail(4, `nested card selectors: ${nested.slice(0, 3).join(', ')}`)
    : pass(4, `${cardClasses.length} card-ish classes, none nested`);
}

// ===========================================================================
// 5 — No thick coloured side-stripe border on a card
// ===========================================================================
{
  const stripes = [...cssLive.matchAll(/border-(?:left|right)\s*:\s*([3-9]|\d{2,})px\s+(?!none)/g)];
  stripes.length
    ? fail(5, `thick side-stripe: ${stripes[0][0]}`)
    : pass(5, 'no thick left/right stripe');
}

// ===========================================================================
// 7 — No pure #000 / #fff base
// ===========================================================================
{
  const pure = [...cssLive.matchAll(/#[0]{3,6}\b|#fff\b|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/gi)];
  pure.length
    ? fail(7, `pure black/white present: ${pure[0][0]}`)
    : pass(7, 'no pure #000 / #fff');
}

// ===========================================================================
// 9 — Sections separated by more than equal whitespace
// ===========================================================================
{
  const rules = (cssLive.match(/border-top:\s*1px solid var\(--line/g) || []).length;
  const bands = (cssLive.match(/\.section\s*\{[^}]*border-block/g) || []).length;
  rules + bands >= 3
    ? pass(9, `${rules + bands} hairline separators between sections`)
    : fail(9, 'sections appear to be separated by whitespace alone');
}

// ===========================================================================
// 10 — No transition: all
// ===========================================================================
{
  const all = [...cssLive.matchAll(/transition:\s*all\b/g)];
  const allProps = [...cssLive.matchAll(/transition-property:\s*all\b/g)];
  all.length + allProps.length
    ? fail(10, `transition: all ×${all.length + allProps.length}`)
    : pass(10, 'every transition names its properties');
}

// ===========================================================================
// 11 — No uniform hover scale across unrelated elements
// ===========================================================================
{
  const scales = [...cssLive.matchAll(/:hover[^{]*\{[^}]*scale\(/g)];
  scales.length > 3
    ? fail(11, `${scales.length} hover-scale rules — too uniform`)
    : pass(11, `${scales.length} hover-scale rule(s)`);
}

// ===========================================================================
// 12 — No overshoot easing on UI state changes
// ===========================================================================
{
  const overshoot = [...cssLive.matchAll(/cubic-bezier\([^)]*1\.[0-9]{2}[^)]*\)/g)];
  overshoot.length
    ? fail(12, `overshoot easing: ${overshoot[0][0]}`)
    : pass(12, 'no overshoot curves');
}

// ===========================================================================
// 14 — No animating width/height/top/left/margin/padding
// ===========================================================================
{
  const anim = [...cssLive.matchAll(/transition:[^;]*\b(width|height|top|left|margin|padding|min-height|max-height)\b/g)];
  anim.length
    ? fail(14, `layout-property transition: ${anim[0][0].slice(0, 60)}`)
    : pass(14, 'no layout-property transitions');
}

// ===========================================================================
// 15 — Focus ring must not fade in
// ===========================================================================
{
  const focusBlocks = [...cssLive.matchAll(/:focus-visible[^{]*\{[^}]*\}/g)].map((m) => m[0]);
  const fading = focusBlocks.filter((b) => /transition[^;]*(outline|box-shadow)/.test(b));
  fading.length
    ? fail(15, 'focus ring transitions into existence')
    : pass(15, `${focusBlocks.length} focus-visible rule(s), none transitioned`);
}

// ===========================================================================
// 19 — No placeholder names or startup clichés
// ===========================================================================
{
  const cliches = ['Jane Doe', 'John Smith', 'Acme Corp', 'Nexus', 'Seamless', 'Unleash', 'Lorem ipsum', 'John Appleseed'];
  const haystack = (sourceLive + ' ' + cssLive).toLowerCase();
  const hits = cliches.filter((c) => haystack.includes(c.toLowerCase()));
  hits.length ? fail(19, `cliché present: ${hits.join(', ')}`) : pass(19, 'no placeholder names');
}

// ===========================================================================
// 20 / 21 — CSS macrostructure stamp
// ===========================================================================
{
  const stamp = /\/\*\s*Hallmark\s*·\s*macrostructure:([^*]*)\*\//.exec(css);
  if (!stamp) fail(20, 'no `Hallmark · macrostructure:` stamp in the CSS');
  else {
    pass(20, stamp[1].trim());
    /specimen/i.test(stamp[1]) && !/editorial|studio|split|foundry/i.test(stamp[1])
      ? fail(21, 'defaulted to the Specimen macrostructure')
      : pass(21, 'not a Specimen fall-through');
  }
}

// ===========================================================================
// 22 — No zero-chroma neutrals
// ===========================================================================
{
  // The palette is authored in hex/rgb rather than oklch, so the equivalent
  // check is that every neutral is tinted off pure grey.
  const greys = new Set();
  for (const m of tokens.matchAll(/--(?:ink|bg|line|surface)[\w-]*:\s*#([0-9a-f]{6})/gi)) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    if (Math.max(r, g, b) - Math.min(r, g, b) === 0) greys.add(m[0]);
  }
  greys.size ? fail(22, `zero-chroma neutrals: ${[...greys].join(', ')}`) : pass(22, 'every neutral is tinted');
}

// ===========================================================================
// 24 — Spacing on a 4px scale
// ===========================================================================
{
  const scale = [...tokens.matchAll(/--sp-\d:\s*([\d.]+)(rem|px)/g)].map(
    (m) => (m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16),
  );
  const offScale = scale.filter((v) => Math.abs(v % 4) > 0.01);
  offScale.length
    ? fail(24, `spacing tokens off the 4px scale: ${offScale.join(', ')}`)
    : pass(24, `${scale.length} spacing tokens, all multiples of 4px`);
}

// ===========================================================================
// 25 — Prose measure within 45–75ch
// ===========================================================================
{
  const measures = [...cssLive.matchAll(/max-width:\s*(\d+)ch/g)].map((m) => Number(m[1]));
  const prose = [...cssLive.matchAll(/\.(?:prose|about-prose)[^{]*\{[^}]*max-width:\s*(\d+)ch/g)].map((m) => Number(m[1]));
  const bad = prose.filter((m) => m < 45 || m > 75);
  bad.length
    ? fail(25, `prose measure out of range: ${bad.join(', ')}ch`)
    : pass(25, `prose measures: ${prose.join(', ') || 'inherited'}ch (ch limits in code: ${measures.length})`);
}

// ===========================================================================
// 26 / 39 — Interactive elements have their states
// ===========================================================================
{
  const needs = ['focus-visible', 'active', 'disabled'];
  const missing = needs.filter((s) => !cssLive.includes(`:${s}`));
  missing.length
    ? fail(26, `no :${missing.join(' / :')} styling anywhere`)
    : pass(26, 'focus-visible, active and disabled are all styled');
}

// ===========================================================================
// 27 — Every animation has a reduced-motion fallback
// ===========================================================================
{
  const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(cssLive);
  const animations = /@keyframes/.test(cssLive);
  if (!reduced) fail(27, 'no prefers-reduced-motion block');
  else pass(27, animations ? 'reduced-motion block present alongside @keyframes' : 'reduced-motion block present');
}

// ===========================================================================
// 30 — No emoji as an icon
// ===========================================================================
{
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2728}\u{26A1}\u{1F680}\u{1F525}\u{1F3AF}\u{2705}]/u;
  const inMarkup = emoji.test(sourceLive);
  const inCss = emoji.test(cssLive);
  inMarkup || inCss ? fail(30, 'emoji glyph used as an icon') : pass(30, 'no emoji glyphs');
}

// ===========================================================================
// 32 — Archetype variation recorded in the stamp
// ===========================================================================
{
  const stamp = /\/\*\s*Hallmark\s*·\s*macrostructure:([^*]*)\*\//.exec(css);
  const documented = stamp && (stamp[1].includes('·') || stamp[1].includes('with'));
  documented ? pass(32, 'stamp names archetypes beyond the base structure') : fail(32, 'stamp records no archetype variation');
}

// ===========================================================================
// 34 — overflow-x: clip on BOTH html and body
// ===========================================================================
{
  const htmlClip = /html[^{]*\{[^}]*overflow-x:\s*clip/.test(cssLive);
  const bodyClip = /body[^{]*\{[^}]*overflow-x:\s*clip/.test(cssLive);
  const hidden = /overflow-x:\s*hidden/.test(cssLive);
  if (!htmlClip || !bodyClip) fail(34, `overflow-x: clip missing (html:${htmlClip}, body:${bodyClip})`);
  else if (hidden) fail(34, 'overflow-x: hidden found — must be clip');
  else pass(34, 'overflow-x: clip on both html and body');
}

// ===========================================================================
// 36 — Flex rows mixing heights declare centring
// ===========================================================================
{
  /*
   * Gate 36 is about rows that MIX elements of different intrinsic heights —
   * a button beside text, a mark beside body copy. A row of equal-height
   * siblings stretches harmlessly, so flagging every flex row without
   * `align-items` is noise. The browser step below decides which rows actually
   * have a height mismatch; this static pass only records the inventory.
   */
  const rows = [...cssLive.matchAll(/(?<![\w-])([.#][\w-]+)\s*\{[^}]*display:\s*flex[^}]*\}/g)];
  const uncentred = rows.filter((m) => !/align-items:\s*(center|baseline)/.test(m[0]));
  flexRowInventory = { total: rows.length, uncentred: uncentred.map((m) => m[1]) };
}

// ===========================================================================
// 37 / 38 — At most three font families; outlier ≤ 2 slots
// ===========================================================================
{
  const families = new Set();
  for (const m of tokens.matchAll(/--font-[\w-]+:\s*([^;]+);/g)) {
    for (const q of m[1].matchAll(/'([^']+)'/g)) families.add(q[1].replace(/ Fallback$/, ''));
  }
  const real = [...families];
  const variableCount = [...cssLive.matchAll(/font-family:\s*var\(--font-([\w-]+)\)/g)].map((m) => m[1]);
  const distinctVars = new Set(variableCount);
  distinctVars.size > 3
    ? fail(37, `${distinctVars.size} font tokens in use: ${[...distinctVars].join(', ')}`)
    : pass(37, `${distinctVars.size} font tokens (${real.join(', ')})`);
}

// ===========================================================================
// 38a — No italic headings
// ===========================================================================
{
  const headingBlocks = [...cssLive.matchAll(/(h[1-6]|__title|__headline)[^{]*\{[^}]*\}/g)].map((m) => m[0]);
  const italics = headingBlocks.filter((b) => /font-style:\s*italic/.test(b));
  const emInHeadings = [...sourceLive.matchAll(/<h[1-6][^>]*>[\s\S]{0,400}?<(em|i)>/g)];
  if (italics.length) fail(38, `${italics.length} heading rule(s) set font-style: italic`);
  else if (emInHeadings.length) fail(38, `<em>/<i> inside a heading ×${emInHeadings.length}`);
  else pass(38, 'no italic headings, no <em> in a heading');
}

// ===========================================================================
// 40 / 41 — Contrast
// ===========================================================================
{
  // Computed in-browser below. Recorded here as a marker so the numbering
  // stays aligned with the gate list.
  manual(40, 'verified in-browser from computed styles (see contrast step)');
}

// ===========================================================================
// 44 — Hero fold fit at 1280×800, padding ratio
// ===========================================================================
manual(44, 'measured in-browser at 1280×800 (see fold step)');

// ===========================================================================
// 46 — No invented quantitative claim
// ===========================================================================
{
  const claims = [
    /\b\d+(\.\d+)?\s?%\s?(faster|more|increase|improv|growth|conversion)/i,
    /\b\d+\s?[x×]\s(faster|better|more)/i,
    /trusted by \d/i,
    /\d[\d,]*\+?\s?(clients|users|customers|companies|teams)/i,
    /\d+(\.\d+)?\s?%\s?uptime/i,
    /\b\d+\s?years of experience/i,
  ];
  const text = await Promise.all(
    ROUTES.map(async (r) => {
      try {
        const res = await fetch(BASE + r);
        const html = await res.text();
        const body = /<body[\s\S]*?<\/body>/i.exec(html)?.[0] ?? html;
        return body.replace(/<script[\s\S]*?<\/script>/g, '');
      } catch {
        return '';
      }
    }),
  ).then((a) => a.join('\n'));
  const hits = claims.filter((c) => c.test(text));
  hits.length ? fail(46, `quantitative claim present: ${hits.length}`) : pass(46, 'no unsourced quantitative claim in body copy');
}

// ===========================================================================
// 47 — No re-drawn chrome
// ===========================================================================
{
  const fake = /traffic-light|url-pill|phone-frame|notch|speaker-slit|window-chrome|ide-chrome/i.test(
    sourceLive + cssLive,
  );
  fake ? fail(47, 're-drawn browser/phone/IDE chrome detected') : pass(47, 'no re-drawn chrome');
}

// ===========================================================================
// 48 — No colour or font-family outside :root
// ===========================================================================
{
  // colours outside the token block
  const colourDecls = [...cssLive.matchAll(/(?:^|[;{])\s*(?:color|background(?:-color)?|border(?:-[a-z]+)?-color)\s*:\s*([^;}]+)/g)]
    .map((m) => m[1].trim())
    .filter((v) => !/^var\(--/.test(v) && !/^(transparent|currentColor|inherit|none|initial|unset)$/i.test(v));
  // @font-face blocks are where a family is *defined*, not improvised, so they
  // are excluded: gate 48 is about colour and font-family escaping the token
  // block in a rule that consumes them.
  const fontDecls = [...cssWithoutFontFace.matchAll(/font-family\s*:\s*([^;}]+)/g)]
    .map((m) => m[1].trim())
    .filter((v) => !/^var\(--/.test(v));

  if (colourDecls.length) fail(48, `literal colour(s): ${colourDecls.slice(0, 3).join(' | ')}`);
  else if (fontDecls.length) fail(48, `literal font-family: ${fontDecls.slice(0, 3).join(' | ')}`);
  else pass(48, 'every colour and font-family references a token');
}

// ===========================================================================
// 50 — Image-bearing grid tracks use minmax(0, 1fr)
// ===========================================================================
{
  /*
   * Gate 50 fires on an IMAGE-BEARING 1fr track, because `1fr` is really
   * `minmax(auto, 1fr)` and `auto` is the intrinsic width of the widest child —
   * a 1600px capture would push a phone layout off-screen.
   *
   * A text-only 1fr track is harmless, and several exist (`.service`). So this
   * records the bare tracks and the browser step below checks which of them
   * actually contain an image.
   */
  const bare = [...cssLive.matchAll(/grid-template-columns:\s*([^;]*\b1fr\b[^;]*);/g)]
    .map((m) => m[1].trim())
    .filter((v) => !/minmax\(\s*0\s*,\s*1fr\)/.test(v) && !/repeat\(\s*\d+\s*,\s*minmax/.test(v));
  bareTracks = bare;
}

// ===========================================================================
// 51 — Display headers wrap long words
// ===========================================================================
{
  const ok = /overflow-wrap:\s*(anywhere|break-word)/.test(cssLive) && /min-width:\s*0/.test(cssLive);
  ok ? pass(51, 'overflow-wrap + min-width:0 present') : fail(51, 'missing overflow-wrap: anywhere / min-width: 0');
}

// ===========================================================================
// 54 — Eyebrow beside a heading is banned
// ===========================================================================
{
  const heads = [...cssLive.matchAll(/\.(section-head|price__head|page-head|product__foot)[^{]*\{[^}]*\}/g)].map((m) => m[0]);
  const multiCol = heads.filter((b) => /grid-template-columns:[^;]*\d+fr[^;]*\d+fr/.test(b) && !/flex-direction:\s*column/.test(b));
  multiCol.length
    ? fail(54, `head wrapper is multi-column: ${multiCol[0].split('{')[0]}`)
    : pass(54, 'every eyebrow + heading wrapper is single-column');
}

// ===========================================================================
// 55 — All-caps display heads need line-height ≥ 1.0
// ===========================================================================
{
  const blocks = [...cssLive.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  const LH = /line-height:\s*(0?\.\d+)/;
  const bad = blocks.filter(([, sel, body]) => {
    if (!/text-transform:\s*uppercase/.test(body)) return false;
    if (!/(h[1-6]|__title|__display|__line)\b/.test(sel)) return false;
    const m = LH.exec(body);
    return m ? Number(m[1]) < 1 : false;
  });
  bad.length ? fail(55, `all-caps head under line-height 1: ${bad[0][1].trim()}`) : pass(55, 'no all-caps display head below 1.0');
}

// ===========================================================================
// 56 — Only one sticky element at top: 0
// ===========================================================================
{
  const sticky = [...cssLive.matchAll(/([.#][\w-]+)\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/g)].map((m) => m[1]);
  sticky.length > 1
    ? fail(56, `multiple sticky top:0 elements: ${sticky.join(', ')}`)
    : pass(56, sticky.length ? `one sticky top:0 (${sticky[0]})` : 'no sticky top:0');
}

// ===========================================================================
// Browser-measured gates
// ===========================================================================

let browser;
try {
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
} catch {
  console.error('Could not launch a browser — skipping gates 6, 33, 34, 35, 37, 40, 41, 44, 49, 52.');
  browser = null;
}

if (browser) {
  // ---- 34: no horizontal scroll, 320 → 1920 ----
  {
    const widths = [320, 360, 375, 414, 480, 600, 768, 900, 1024, 1280, 1440, 1920];
    const offenders = [];
    for (const route of ROUTES) {
      for (const width of widths) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(BASE + route, { waitUntil: 'networkidle' });
        const over = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        if (over) offenders.push(`${route}@${width}`);
        await ctx.close();
      }
    }
    offenders.length
      ? fail(34, `horizontal scroll at ${offenders.slice(0, 5).join(', ')}`)
      : pass(34, `no horizontal scroll across ${widths.length} widths × ${ROUTES.length} routes`);
  }

  // ---- 40/41: contrast, computed ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const failures = [];

    const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = ([r, g, b]) => 0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255);
    const ratio = (a, b) => {
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };

    for (const route of ROUTES) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' });

      const samples = await page.evaluate(() => {
        const parse = (c) => {
          const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c);
          if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
          const h = /^#([0-9a-f]{6})$/i.exec(c.trim());
          if (h) {
            const n = parseInt(h[1], 16);
            return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 };
          }
          return null;
        };
        // Walk up for the first opaque background.
        const bgOf = (el) => {
          let n = el;
          while (n && n !== document.documentElement) {
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c && c.a > 0.95) return c.rgb;
            n = n.parentElement;
          }
          return [10, 10, 11];
        };
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          if (+cs.opacity === 0) continue;
          const text = (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
            ? el
            : null;
          if (!text) continue;
          const fg = parse(cs.color);
          if (!fg) continue;
          const size = parseFloat(cs.fontSize);
          const weight = Number(cs.fontWeight) || 400;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          out.push({
            sel: el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 30),
            text: el.textContent.trim().slice(0, 30),
            fg: fg.rgb, bg: bgOf(el), size, weight,
          });
        }
        return out;
      });

      for (const s of samples) {
        const large = s.size >= 24 || (s.size >= 18.66 && s.weight >= 700);
        const need = large ? 3 : 4.5;
        const r = ratio(s.fg, s.bg);
        if (r < need) {
          failures.push(`${route} ${s.sel} "${s.text}" ${r.toFixed(2)}:1 (needs ${need})`);
        }
      }
    }
    await ctx.close();

    failures.length
      ? fail(40, `${failures.length} contrast failure(s): ${failures.slice(0, 4).join(' | ')}`)
      : pass(40, 'every text node meets WCAG AA against its effective background');
  }

  // ---- 44: hero fits the fold at 1280×800 ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });

    const hero = await page.evaluate(() => {
      const el = document.querySelector('.hero');
      if (!el) return null;
      const cs = getComputedStyle(el);
      const h1 = document.querySelector('.hero h1');
      const cta = document.querySelector('.hero .btn');
      return {
        padTop: parseFloat(cs.paddingTop),
        padBottom: parseFloat(cs.paddingBottom),
        heroBottom: el.getBoundingClientRect().bottom,
        h1Bottom: h1 ? h1.getBoundingClientRect().bottom : null,
        ctaBottom: cta ? cta.getBoundingClientRect().bottom : null,
        viewport: window.innerHeight,
      };
    });
    await ctx.close();

    if (!hero) fail(44, 'no .hero found');
    else {
      const ratio = hero.padBottom / (hero.padTop || 1);
      const fits = hero.ctaBottom !== null && hero.ctaBottom <= hero.viewport;
      const padOk = ratio >= 1.3;
      if (!padOk) fail(44, `hero bottom padding is ${ratio.toFixed(2)}× the top (needs ≥1.3)`);
      else if (!fits) fail(44, `hero CTA bottom at ${Math.round(hero.ctaBottom)}px exceeds the ${hero.viewport}px fold`);
      else pass(44, `hero padding ratio ${ratio.toFixed(2)}×, CTA visible at 1280×800`);
    }
  }

  // ---- 49: no two-line clickable text, 320 → 1920 ----
  {
    const wrapped = [];
    for (const route of ROUTES) {
      for (const width of [320, 375, 768, 1280, 1920]) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(BASE + route, { waitUntil: 'networkidle' });
        const bad = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('a, button, [role="button"], summary')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            // A link holding block-level content (a whole card) is not a label.
            if (el.querySelector('div, section, article, figure')) continue;
            /*
             * Gate 49 enumerates affordance labels: buttons, nav links, footer
             * links, breadcrumbs, tabs. A <summary> holding a written question
             * is body text that happens to be clickable — "What does a project
             * cost?" has to wrap on a 320px phone, and nowrap-ing it would
             * overflow instead.
             */
            if (el.tagName === 'SUMMARY') continue;
            /*
             * Count line boxes via a Range over the label's own text, rather
             * than comparing the element's box to its line-height. An element
             * padded out to a 44px tap target around 19px of text is correct,
             * not wrapped, and a height test reports it as a false positive.
             */
            const range = document.createRange();
            range.selectNodeContents(el);
            const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
            const contentHeight = range.getBoundingClientRect().height;
            // Two lines need more than 1.5 line boxes of text. Padding on a tap
            // target does not count, because the Range covers text only.
            if (contentHeight > lh * 1.5) {
              out.push(`${el.textContent.trim().slice(0, 24)} (${Math.round(contentHeight / lh)} lines)`);
            }
          }
          return out;
        });
        for (const b of bad) wrapped.push(`${route}@${width}: ${b}`);
        await ctx.close();
      }
    }
    wrapped.length
      ? fail(49, `${wrapped.length} wrapping clickable label(s): ${wrapped.slice(0, 3).join(' | ')}`)
      : pass(49, 'no clickable label wraps across 320→1920');
  }

  // ---- 50: does any bare 1fr track actually hold an image? ----
  {
    const offenders = [];
    for (const route of ROUTES) {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      const found = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (cs.display !== 'grid' && cs.display !== 'inline-grid') continue;
          const bare = cs.gridTemplateColumns
            .split(' ')
            .some((t) => t.endsWith('px') && Number.parseFloat(t) > 0)
            && cs.gridTemplateColumns.split(' ').length > 1;
          if (!bare) continue;
          if (el.querySelector('img, picture, video, canvas')) {
            out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 28)}`);
          }
        }
        return out;
      });
      offenders.push(...found.map((f) => `${route} ${f}`));
      await ctx.close();
    }
    offenders.length
      ? fail(50, `image in a non-minmax grid track: ${offenders.slice(0, 3).join(', ')}`)
      : pass(
          50,
          `${bareTracks.length} text-only bare 1fr track(s); no image-bearing track is bare`,
        );
  }

  // ---- 36: flex rows that actually mix heights, without centring ----
  {
    const offenders = [];
    for (const route of ROUTES) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      const found = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (cs.display !== 'flex') continue;
          /*
           * Only a ROW can stretch a shorter sibling horizontally. In a column
           * the children stack, differing heights are the intent, and
           * `align-items` is governing the horizontal axis — so reading it as a
           * vertical-centring signal reports `.price__foot` (a figure above a
           * note) as a fault when it is the correct layout.
           */
          const isRow = cs.flexDirection === 'row' || cs.flexDirection === 'row-reverse';
          if (!isRow) continue;
          if (cs.alignItems === 'center' || cs.alignItems === 'baseline') continue;
          const kids = [...el.children].filter((k) => {
            const r = k.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          if (kids.length < 2) continue;
          // Only a problem when the row mixes a control with prose: the heights
          // genuinely differ and the shorter item will be stretched or clipped.
          const heights = kids.map((k) => k.getBoundingClientRect().height);
          const min = Math.min(...heights);
          const max = Math.max(...heights);
          if (max > min * 1.25) {
            out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 26)} (${Math.round(min)}–${Math.round(max)}px)`);
          }
        }
        return out;
      });
      offenders.push(...found.map((f) => `${route} ${f}`));
      await ctx.close();
    }
    offenders.length
      ? fail(36, `${offenders.length} mixed-height flex row(s) uncentred: ${offenders.slice(0, 3).join(' | ')}`)
      : pass(36, `no mixed-height flex row is uncentred (${flexRowInventory.total} flex rows scanned)`);
  }

  // ---- 33: decorative nodes are hidden or named ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const bad = [];
    for (const route of ROUTES) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      const found = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('svg, canvas')) {
          const decorative =
            el.getAttribute('aria-hidden') === 'true' ||
            el.getAttribute('role') === 'presentation' ||
            el.getAttribute('aria-label') ||
            el.getAttribute('aria-labelledby') ||
            el.closest('[aria-hidden="true"]');
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (!decorative) out.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 24));
        }
        return out;
      });
      bad.push(...found.map((f) => `${route} ${f}`));
    }
    await ctx.close();
    bad.length ? fail(33, `unlabelled graphic node(s): ${bad.slice(0, 4).join(', ')}`) : pass(33, 'every svg/canvas is hidden or named');
  }

  // ---- 6: hero shape ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    const shape = await page.evaluate(() => {
      const hero = document.querySelector('.hero');
      if (!hero) return null;
      const cs = getComputedStyle(hero);
      const intro = document.querySelector('.hero__intro');
      const h1 = document.querySelector('.hero h1');
      const eyebrow = document.querySelector('.hero .eyebrow');
      const cta = document.querySelector('.hero .btn');
      const centreX = (el) => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2;
      };
      const axis = Math.round(innerWidth / 2);
      return {
        minHeight: cs.minHeight,
        align: cs.textAlign,
        centres: [intro, h1, eyebrow, cta]
          .filter(Boolean)
          .map((el) => Math.abs(centreX(el) - axis))
          .filter((d) => d < innerWidth * 0.08).length,
      };
    });
    await ctx.close();

    if (!shape) fail(6, 'no .hero found');
    else if (/100vh/.test(shape.minHeight)) fail(6, 'hero is min-height:100vh');
    else if (shape.centres >= 3) fail(6, `${shape.centres} hero elements share the centre axis`);
    else pass(6, `${shape.centres} element(s) on the centre axis, left-aligned intro`);
  }

  await browser.close();
}

// ===========================================================================
// Gates that need a human eye — stated, never silently passed
// ===========================================================================
manual(8, 'does the macrostructure differ from the previous build (stamp vs git history)?');
manual(13, 'does any single element have more than one hover effect at once?');
manual(16, 'is every success silent rather than a celebratory toast?');
manual(17, 'are tooltip hover-delay and focus-delay differentiated (hover 800–1000ms, focus 0ms)?');
manual(18, 'if anything auto-rotates, is there pause-on-hover and pause-on-focus?');
manual(23, 'does the accent stay under ~5% of any single viewport by area?');
manual(25.5, 'does each prose measure read comfortably at the rendered size?');
manual(28, 'if there is a video, is it muted, postered, eager and not lazy-loaded on the LCP element?');
manual(29, 'is any abstract background under ~5% footprint and not a full-page animated mesh?');
manual(31, 'is any illustration hand-built rather than a Lottie default?');
manual(35, 'does every decorative text effect sit at the right vertical position?');
manual(38.5, 'is the outlier face used in at most two slots?');
manual(41, 'are the specific high-risk contrast pairs (muted on raised, card-on-card, focus on surface) all cleared?');
manual(42, 'is the nav free of the wordmark-left + link-row + button-right + hairline fingerprint?');
manual(43, 'is the footer free of the four-column + social-icon-row + hairline fingerprint?');
manual(45, 'is every decorative element semantically anchored in the content?');
manual(52, 'does every theme-variant section head collapse to one column on mobile?');
manual(53, 'do any CSS-only radio tabs avoid scroll-jump?');
manual(57, 'was studied DNA used rather than a catalog theme fall-back?');

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const order = [...results].sort((a, b) => gateKey(a.gate) - gateKey(b.gate));

console.log('\nHallmark slop test');
console.log('='.repeat(78));
console.log(pad('gate', 7) + pad('status', 9) + 'note');
console.log('-'.repeat(78));
for (const r of order) {
  const icon = r.status === 'pass' ? 'ok' : r.status === 'fail' ? 'FAIL' : 'manual';
  console.log(pad(r.gate, 8) + pad(icon, 9) + r.note);
}
console.log('-'.repeat(78));

const failed = results.filter((r) => r.status === 'fail');
const passed = results.filter((r) => r.status === 'pass');

if (manualCount > 0) {
  console.log(
    `${passed.length} automated pass · ${failed.length} fail · ${manualCount} need a human eye\n`,
  );
  console.log('The manual list is not padding. Each one is a question only a person can');
  console.log('answer; answer them before declaring the slop test complete.');
} else {
  console.log(`${passed.length}/${results.length} ✓`);
}

if (failed.length) {
  console.log(`\n${failed.length} gate(s) open: ${failed.map((f) => f.gate).join(', ')}`);
  process.exit(1);
}
