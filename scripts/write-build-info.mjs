#!/usr/bin/env node
// Stamp the build for the About sheet and Help → Copy Diagnostics (plan 002):
// writes electron/dist/build-info.json = { sha, builtAt, dirty }. Runs after
// `tsc` in build:electron; electron/dist/** already ships in the app, so no
// packaging change. Without git (a source tarball) it writes sha "unknown"
// rather than failing the build. Read by electron/src/appInfo.ts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

let sha = 'unknown';
let dirty = false;
try {
  sha = git('rev-parse', '--short', 'HEAD');
  dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
} catch { /* no git: keep the defaults */ }

const out = join(root, 'electron', 'dist', 'build-info.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ sha, builtAt: new Date().toISOString(), dirty })}\n`);
