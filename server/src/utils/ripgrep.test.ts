import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { getRipgrepPath, resetRipgrepCacheForTests } from './ripgrep.js';

test('getRipgrepPath resolves a runnable ripgrep binary in dev', () => {
  resetRipgrepCacheForTests();
  delete process.env.ARGUS_RG_PATH;
  const rg = getRipgrepPath();
  // @vscode/ripgrep is a server dependency, so it must resolve in the dev tree.
  assert.ok(rg, 'expected a ripgrep path');
  const version = execFileSync(rg!, ['--version'], { encoding: 'utf-8' });
  assert.match(version, /ripgrep/);
});

test('ARGUS_RG_PATH override wins when it points at an existing file', () => {
  resetRipgrepCacheForTests();
  const real = execFileSync('which', ['node'], { encoding: 'utf-8' }).trim();
  process.env.ARGUS_RG_PATH = real;
  try {
    assert.equal(getRipgrepPath(), real);
  } finally {
    delete process.env.ARGUS_RG_PATH;
    resetRipgrepCacheForTests();
  }
});

test('a non-existent override is ignored (does not throw, falls through)', () => {
  resetRipgrepCacheForTests();
  process.env.ARGUS_RG_PATH = '/nonexistent/path/to/rg';
  try {
    // Falls through to @vscode/ripgrep, which is installed — so still resolves.
    assert.ok(getRipgrepPath());
  } finally {
    delete process.env.ARGUS_RG_PATH;
    resetRipgrepCacheForTests();
  }
});
