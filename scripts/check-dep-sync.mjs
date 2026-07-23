#!/usr/bin/env node
// Guard against the packaged-app missing-dependency class of release breakage
// (v0.21.0 node-pty helper, v0.21.1 @xterm/addon-serialize, latent @vscode/ripgrep).
//
// electron-builder prunes `node_modules/**` down to the dependency tree of the
// ROOT package.json — a runtime dep declared only in server/package.json gets
// hoisted into node_modules (so dev works) but EXCLUDED from app.asar, and the
// packaged app crashes with ERR_MODULE_NOT_FOUND at launch (or silently loses a
// feature when the import is lazy). Invariant: every server runtime dep must
// also be declared in root dependencies. Workspace packages (@argus/*) are
// exempt — their dist/ is listed explicitly in electron-builder `files`.
//
// Run: `npm run check:deps` (wired into CI and package:mac).

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(path.join(repoRoot, p), 'utf8'));

const rootDeps = new Set(Object.keys(read('package.json').dependencies ?? {}));
const serverDeps = Object.keys(read('server/package.json').dependencies ?? {});

const missing = serverDeps.filter((d) => !d.startsWith('@argus/') && !rootDeps.has(d));

if (missing.length > 0) {
  console.error('✖ dep-sync: server runtime deps missing from ROOT package.json:');
  for (const d of missing) console.error(`    ${d}`);
  console.error(
    '\n  The packaged app bundles only root dependencies into app.asar.\n' +
      '  Add each package to the root package.json "dependencies" (same version)\n' +
      '  and run `npm install` to update the lockfile.',
  );
  process.exit(1);
}

console.log(`✔ dep-sync: all ${serverDeps.length} server runtime deps present in root package.json`);
