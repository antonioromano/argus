#!/usr/bin/env node
/**
 * Inline-style audit for the renderer (plan 005, R1). Re-runnable measurement of
 * how much layout still lives in `style={{…}}` and how far the ratchet has got.
 *
 *   npm run audit:styles            # tables
 *   npm run audit:styles -- --json  # machine-readable
 *
 * Blocks: every `style={{…}}` in client/src/**\/*.tsx (tests excluded), brace-
 * matched. "Static" = only string/number literal values. Violations come from
 * the real `argus/no-raw-style-scale` rule, so the numbers match `npm run lint`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from '../client/eslint-rules/no-raw-style-scale.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const SRC = path.join(CLIENT, 'src');
const asJson = process.argv.includes('--json');

function tsxFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return name.endsWith('.tsx') && !/\.test\.tsx$/.test(name) && !/\.archived\.tsx$/.test(name) ? [p] : [];
  });
}

/** Bodies of every `style={{ … }}` in a source file. */
function styleBlocks(src) {
  const out = [];
  for (const m of src.matchAll(/style=\{\{/g)) {
    let depth = 2;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    out.push(src.slice(start, i - 2));
  }
  return out;
}

/** Every `key: value` value is a plain string or number literal. */
function isStatic(body) {
  if (/\.\.\./.test(body)) return false;
  const values = body.split(/,(?![^(]*\))/).map((kv) => kv.split(':').slice(1).join(':').trim()).filter(Boolean);
  return values.every((v) => /^(-?\d+(\.\d+)?|'[^']*'|"[^"]*")$/.test(v));
}

/** Directory bucket used in the plan's tables. */
function bucket(rel) {
  const parts = rel.split('/');
  if (parts[0] === 'app' && parts[1] === 'overlays') {
    if (parts[2] === 'settings' || parts[2] === 'diff') return `app/overlays/${parts[2]}`;
    return 'app/overlays';
  }
  if (parts[0] === 'app' && parts.length > 2) return `app/${parts[1]}`;
  if (parts[0] === 'components' && parts.length > 2) return `components/${parts[1]}`;
  return 'other';
}

const linter = new Linter({ configType: 'flat' });
const config = [
  {
    files: ['**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { argus: { rules: { 'no-raw-style-scale': rule } } },
    rules: { 'argus/no-raw-style-scale': 'error' },
  },
];

const dirs = new Map();
const byProp = new Map();
let blocks = 0;
let staticBlocks = 0;
let violations = 0;

for (const file of tsxFiles(SRC)) {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  const src = readFileSync(file, 'utf8');
  const found = styleBlocks(src);
  const msgs = linter.verify(src, config, { filename: path.relative(CLIENT, file) })
    .filter((m) => m.ruleId === 'argus/no-raw-style-scale');

  const d = dirs.get(bucket(rel)) ?? { blocks: 0, violations: 0, files: 0 };
  d.blocks += found.length;
  d.violations += msgs.length;
  if (msgs.length) d.files++;
  dirs.set(bucket(rel), d);

  blocks += found.length;
  staticBlocks += found.filter(isStatic).length;
  violations += msgs.length;
  for (const m of msgs) {
    const prop = m.message.split(':')[0];
    byProp.set(prop, (byProp.get(prop) ?? 0) + 1);
  }
}

const sortDesc = (map) => [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
const report = {
  blocks,
  staticBlocks,
  staticPct: blocks ? Math.round((staticBlocks / blocks) * 100) : 0,
  violations,
  violationFiles: [...dirs.values()].reduce((n, d) => n + d.files, 0),
  byDirectory: Object.fromEntries([...dirs].sort((a, b) => b[1].blocks - a[1].blocks)),
  byProp: Object.fromEntries(sortDesc(byProp)),
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Inline style blocks: ${blocks} (${report.staticPct}% static)`);
  console.log(`Raw-scale violations: ${violations} in ${report.violationFiles} files\n`);
  console.log('| Dir | Blocks | Violations | Files w/ violations |');
  console.log('|---|---:|---:|---:|');
  for (const [dir, d] of Object.entries(report.byDirectory)) {
    console.log(`| \`${dir}\` | ${d.blocks} | ${d.violations} | ${d.files} |`);
  }
  console.log('\n| Prop | Violations |');
  console.log('|---|---:|');
  for (const [prop, n] of Object.entries(report.byProp)) console.log(`| ${prop} | ${n} |`);
}
