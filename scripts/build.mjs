#!/usr/bin/env node
/**
 * Build guard.
 *
 * `astro build` can exit 0 while refusing to start: an invalid value in
 * astro.config.mjs makes the config fail to load, and the previous `dist/` is
 * left sitting there untouched. That is a genuinely dangerous failure mode,
 * because every subsequent test, screenshot and performance number then runs
 * against stale output and reports success.
 *
 * It happened here once — a `script-src-elem` entry inside `security.csp.directives`
 * — and the only reason it was caught was a stale mtime noticed by accident.
 *
 * This wrapper removes the possibility: it deletes dist, runs the build, and
 * fails if the output is missing. A build that did not really happen cannot
 * report success.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');

rmSync(dist, { recursive: true, force: true });

const result = spawnSync('npx', ['astro', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, FORCE_COLOR: '0' },
});

if (result.status !== 0) {
  console.error('\nBuild failed.');
  process.exit(result.status ?? 1);
}

if (!existsSync(dist)) {
  console.error(
    '\nastro build exited 0 but produced no dist/ directory.\n' +
      'This is the silent-config-failure mode: astro.config.mjs probably failed\n' +
      'to load, and a previous build is still on disk pretending to be current.',
  );
  process.exit(1);
}

/*
 * Staleness canary: a page that is prerendered on purpose. It cannot be the
 * home page — src/pages/index.astro is server-rendered, so no root
 * index.html is emitted — and /contact is static, so it ships every build.
 */
const entry = resolve(dist, 'client/contact/index.html');
if (!existsSync(entry)) {
  console.error(`\nBuild produced no ${entry}.`);
  console.error('A prerendered route should always be present; check astro.config.mjs.');
  process.exit(1);
}

const age = Date.now() - statSync(entry).mtimeMs;
if (age > 10 * 60_000) {
  console.error(`\n${entry.replace(`${root}/`, '')} is ${Math.round(age / 60000)} minutes old — stale.`);
  process.exit(1);
}

/*
 * Public-surface placeholder guard.
 *
 * `hasPlaceholders()` in src/config/site.ts exists to answer exactly this
 * question, but it was only ever consulted by a warning that nobody read — and
 * the unresolved social URLs shipped publicly on every page while the build
 * stayed green. That is the failure this check removes.
 *
 * Unresolved identity values are allowed to sit in the *source*: the site has
 * to build before there is a domain or an email. They are not allowed in the
 * *output*, because the output is the public site. Any template that renders a
 * placeholder by accident now fails the build rather than shipping it.
 */
const PLACEHOLDER = /PLACEHOLDER|lorem ipsum|\bTODO\b/;

/** Every file a browser can fetch. */
function publicFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...publicFiles(full));
    else if (/\.(html|js|json|xml|txt|webmanifest)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const offenders = [];

for (const file of publicFiles(dist)) {
  const body = readFileSync(file, 'utf8');
  // Only the visible surface and the metadata a crawler reads: a stray
  // "TODO" inside a source-mapped comment is not a shipping defect.
  const surface = [
    ...(body.match(/<body[^>]*>[\s\S]*?<\/body>/gi) ?? []),
    ...(body.match(/<head[^>]*>[\s\S]*?<\/head>/gi) ?? []),
    body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)?.[0] ?? '',
  ].join('\n');

  for (const match of surface.matchAll(new RegExp(PLACEHOLDER, 'gi'))) {
    const at = Math.max(0, match.index - 60);
    offenders.push(
      `${file.replace(`${root}/`, '')}: ${JSON.stringify(surface.slice(at, match.index + 60))}`,
    );
  }
}

if (offenders.length > 0) {
  console.error('\nBuild failed: placeholder text reached the public output.\n');
  for (const line of offenders.slice(0, 12)) console.error(`  ${line}`);
  if (offenders.length > 12) console.error(`  ...and ${offenders.length - 12} more`);
  console.error(
    '\nUnresolved identity values are fine in src/config/site.ts and must be\n' +
      'filtered at the point of rendering — see publishableSocial() in that file.\n' +
      'A template rendering a placeholder directly is the bug this check exists for.',
  );
  process.exit(1);
}

console.log(`\nBuild verified: dist written ${Math.round(age / 1000)}s ago, no placeholders.`);
