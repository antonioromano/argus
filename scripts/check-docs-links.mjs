#!/usr/bin/env node
// Every link the app, the README or the release notes make into the docs site
// (plan 009, `site/` on GitHub Pages) must land on a page that exists:
//   - each BETA_FEATURES entry's `docsSlug` → site/beta/<slug>.md
//   - each `docsUrl('/path/#anchor')` literal in client/ and electron/ sources
//   - each https://antonioromano.github.io/argus/… URL in README.md and the workflows
// An anchor must exist on its page as a kramdown `{#id}` attribute.
//
// Run: `node scripts/check-docs-links.mjs` (part of `npm run check:deps`).

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(repoRoot, 'site');
const SITE_URL = 'https://antonioromano.github.io/argus';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** '/features/x/#y' → { file: site/features/x.md, anchor: 'y' } */
function resolve(urlPath) {
  const [rawPath, anchor] = urlPath.split('#');
  const clean = rawPath.replace(/^\/+|\/+$/g, '');
  const file = clean === '' ? path.join(SITE, 'index.md') : path.join(SITE, `${clean}.md`);
  return { file, anchor };
}

const problems = [];
let checked = 0;

function check(urlPath, from) {
  checked++;
  const { file, anchor } = resolve(urlPath);
  if (!existsSync(file)) {
    problems.push(`${from}: ${urlPath} → missing ${path.relative(repoRoot, file)}`);
    return;
  }
  if (anchor && !readFileSync(file, 'utf8').includes(`{#${anchor}}`)) {
    problems.push(`${from}: ${urlPath} → ${path.relative(repoRoot, file)} has no {#${anchor}}`);
  }
}

// 1. Beta features
const beta = readFileSync(path.join(repoRoot, 'client/src/utils/betaFlags.ts'), 'utf8');
for (const m of beta.matchAll(/docsSlug:\s*'([^']+)'/g)) check(`/beta/${m[1]}/`, 'betaFlags.ts');

// 2. docsUrl('…') literals in app sources
for (const dir of ['client/src', 'electron/src']) {
  for (const file of walk(path.join(repoRoot, dir))) {
    if (/\.test\.tsx?$/.test(file)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/docsUrl\('([^']*)'\)/g)) check(m[1], path.relative(repoRoot, file));
  }
}

// 3. Absolute links in the README and the workflows (release notes footer)
const docs = ['README.md', ...readdirSync(path.join(repoRoot, '.github/workflows')).map((f) => `.github/workflows/${f}`)];
const abs = new RegExp(`${SITE_URL.replace(/[.]/g, '\\.')}(/[^\\s)"'\`>]*)?`, 'g');
for (const rel of docs) {
  const src = readFileSync(path.join(repoRoot, rel), 'utf8');
  for (const m of src.matchAll(abs)) check(m[1] || '/', rel);
}

if (problems.length > 0) {
  console.error('✖ docs-links: links into the docs site that land nowhere:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  Add the page under site/ (or fix the link). See docs/plans/2026-10-29-009-*.md, unit D1.');
  process.exit(1);
}

console.log(`✔ docs-links: ${checked} link(s) into the docs site resolve`);
