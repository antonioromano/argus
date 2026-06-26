// Single-source the version: root package.json is the source of truth.
// Stamps every workspace package.json and the README version badge to match.
// Run after bumping the root version: `npm run sync-versions`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootPkgPath = join(repoRoot, 'package.json');
const version = JSON.parse(readFileSync(rootPkgPath, 'utf8')).version;

const workspaces = ['shared', 'server', 'client'];
let changed = 0;

for (const ws of workspaces) {
  const pkgPath = join(repoRoot, ws, 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  const next = raw.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
  if (next !== raw) {
    writeFileSync(pkgPath, next);
    console.log(`synced ${ws}/package.json -> ${version}`);
    changed++;
  }
}

// README version badge: ![Version](https://img.shields.io/badge/version-X.Y.Z-blue)
const readmePath = join(repoRoot, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const nextReadme = readme.replace(
  /(badge\/version-)[^-]*(-blue)/,
  `$1${version}$2`,
);
if (nextReadme !== readme) {
  writeFileSync(readmePath, nextReadme);
  console.log(`synced README version badge -> ${version}`);
  changed++;
}

console.log(changed ? `\n${changed} file(s) updated to ${version}.` : `Already in sync at ${version}.`);
