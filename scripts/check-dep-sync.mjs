#!/usr/bin/env node
// Guard against the packaged-app missing-dependency class of release breakage
// (v0.21.0 node-pty helper, v0.21.1 @xterm/addon-serialize, latent @vscode/ripgrep,
// v0.22.5 a *value* import of @argus/shared from server code).
//
// electron-builder prunes `node_modules/**` down to the dependency tree of the
// ROOT package.json — a runtime dep declared only in server/package.json gets
// hoisted into node_modules (so dev works) but EXCLUDED from app.asar, and the
// packaged app crashes with ERR_MODULE_NOT_FOUND at launch (or silently loses a
// feature when the import is lazy). Invariant: every server runtime dep must
// also be declared in root dependencies. Workspace packages (@argus/*) are
// exempt from that check — but only because server code must never import them
// at RUNTIME: the asar ships `shared/dist/` at a path no bare specifier can
// resolve (there is no `node_modules/@argus/shared` inside it), so `import type`
// erases fine while a value import kills the app at launch. Check 2 enforces
// that, and check 3 keeps the constants duplicated across the boundary in sync.
//
// Run: `npm run check:deps` (wired into CI and package:mac).

import { readFileSync, readdirSync, statSync } from 'fs';
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

// ---------------------------------------------------------------------------
// Check 2: no runtime (value) imports of a workspace package from packaged code.
// ---------------------------------------------------------------------------

/** Every .ts file under a directory, tests included. */
function tsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(path.join(repoRoot, dir))) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(repoRoot, rel)).isDirectory()) out.push(...tsFiles(rel));
    else if (entry.endsWith('.ts')) out.push(rel);
  }
  return out;
}

// `import type { … } from '@argus/x'` and `import { type A } from '@argus/x'`
// erase at compile time; anything else emits a runtime require of the package.
// `[^;]` keeps a match inside one statement, so a preceding `import path from
// 'path';` can never be swallowed into this one's clause.
const VALUE_IMPORT = /import\s+(?!type\b)([^;]*?)\s*from\s*['"](@argus\/[^'"]+)['"]/g;

// Both trees are loaded from inside app.asar at runtime, so both are subject to
// the same resolution limit. electron/src is type-only today; keep it that way.
const PACKAGED_TREES = ['server/src', 'electron/src'];

const offenders = [];
for (const file of PACKAGED_TREES.flatMap(tsFiles)) {
  const src = readFileSync(path.join(repoRoot, file), 'utf8');
  for (const [, clause, pkg] of src.matchAll(VALUE_IMPORT)) {
    // A brace clause whose every specifier is `type X` is still type-only.
    const specifiers = clause.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    const allTypeOnly = specifiers.length > 0 && specifiers.every((s) => s.startsWith('type '));
    if (!allTypeOnly) offenders.push({ file, pkg, clause: clause.replace(/\s+/g, ' ').trim() });
  }
}

if (offenders.length > 0) {
  console.error('✖ dep-sync: packaged code imports a workspace package at RUNTIME:');
  for (const o of offenders) console.error(`    ${o.file}: import ${o.clause} from '${o.pkg}'`);
  console.error(
    '\n  The packaged app cannot resolve `@argus/*` bare specifiers — app.asar has\n' +
      '  no node_modules/@argus, so the app dies at launch with ERR_MODULE_NOT_FOUND\n' +
      '  (shipped broken in v0.22.5). Use `import type` only, and duplicate any value\n' +
      '  you need into server/src/constants/ (check 3 keeps the copies in sync).',
  );
  process.exit(1);
}

console.log(`✔ dep-sync: ${PACKAGED_TREES.join(' + ')} import no workspace package at runtime`);

// ---------------------------------------------------------------------------
// Check 3: constants duplicated across the server/shared boundary agree.
// ---------------------------------------------------------------------------

/** Read `export const NAME = <number>` out of a TS source file. */
function numericConst(file, name) {
  const src = readFileSync(path.join(repoRoot, file), 'utf8');
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
}

const DUPLICATED_CONSTS = [
  { name: 'SESSION_NAME_MAX', shared: 'shared/src/types.ts', server: 'server/src/constants/session.ts' },
];

const drifted = DUPLICATED_CONSTS.filter((c) => {
  const a = numericConst(c.shared, c.name);
  const b = numericConst(c.server, c.name);
  return a === null || b === null || a !== b;
}).map((c) => `${c.name}: ${c.shared}=${numericConst(c.shared, c.name)} vs ${c.server}=${numericConst(c.server, c.name)}`);

if (drifted.length > 0) {
  console.error('✖ dep-sync: constant duplicated across the server/shared boundary has drifted:');
  for (const d of drifted) console.error(`    ${d}`);
  console.error('\n  Server code cannot import these at runtime, so both copies must be edited together.');
  process.exit(1);
}

console.log(`✔ dep-sync: ${DUPLICATED_CONSTS.length} cross-boundary constant(s) in sync`);
