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
import { existsSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

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

const entry = resolve(dist, 'client/index.html');
if (!existsSync(entry)) {
  console.error(`\nBuild produced no ${entry}.`);
  process.exit(1);
}

const age = Date.now() - statSync(entry).mtimeMs;
if (age > 10 * 60_000) {
  console.error(`\ndist/client/index.html is ${Math.round(age / 60000)} minutes old — stale.`);
  process.exit(1);
}

console.log(`\nBuild verified: dist written ${Math.round(age / 1000)}s ago.`);
