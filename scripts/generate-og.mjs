#!/usr/bin/env node
/**
 * Build-time asset generation.
 *
 * Renders the branded Open Graph image with sharp, in Node, before the Astro
 * build. This cannot be an Astro route: the Cloudflare adapter prerenders with
 * workerd, which cannot load sharp, so a route-based generator fails at build
 * even when the route itself is fully prerendered.
 *
 * The output is a static file in public/, so it costs nothing at runtime and is
 * picked up automatically by whatever is in src/config/site.ts.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';

// Read the studio name/tagline straight from the config so the OG image
// cannot drift from the site. Parsed rather than imported: the file is
// TypeScript and this runs before any build step can compile it.
function readStudioConfig() {
  const path = new URL('../src/config/site.ts', import.meta.url);
  const source = readFileSync(path, 'utf8');
  const pick = (key) => {
    const m = new RegExp(`^\\s*${key}:\\s*'([^']*)'`, 'm').exec(source);
    return m ? m[1] : '';
  };
  return { name: pick('name') || 'Studio', tagline: pick('tagline') || '' };
}

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const { name, tagline } = readStudioConfig();
const shortTag = tagline.length > 72 ? `${tagline.slice(0, 70)}…` : tagline;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0a0a0b"/>
  <rect x="0" y="0" width="1200" height="8" fill="#b8f14a"/>
  <g font-family="Georgia, 'Times New Roman', serif">
    <text x="80" y="286" font-size="92" fill="#ededf0">${esc(name)}</text>
  </g>
  <text x="80" y="352" font-family="Menlo, Consolas, monospace" font-size="26" fill="#9a9aa4">${esc(shortTag)}</text>
  <rect x="80" y="410" width="120" height="1" fill="#2a2a30"/>
  <text x="80" y="500" font-family="Menlo, Consolas, monospace" font-size="20" fill="#6e6e78">creations · services · process · contact</text>
</svg>`;

const out = new URL('../public/og-default.png', import.meta.url);
mkdirSync(new URL('../public/', import.meta.url), { recursive: true });

const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toBuffer();
writeFileSync(out, png);

console.log(`og-default.png  ${(png.length / 1024).toFixed(1)} KB  "${name}"`);
