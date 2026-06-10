import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWithinBase, resolveRelativeWithinBase } from './pathScope.js';

const BASE = '/home/u/project';

test('accepts a file directly inside the base', () => {
  assert.equal(resolveWithinBase(BASE, '/home/u/project/src/index.ts'), '/home/u/project/src/index.ts');
});

test('accepts the base itself', () => {
  assert.equal(resolveWithinBase(BASE, '/home/u/project'), '/home/u/project');
});

test('normalizes . and redundant separators', () => {
  assert.equal(resolveWithinBase(BASE, '/home/u/project/./src//a.ts'), '/home/u/project/src/a.ts');
});

test('rejects a traversal escape', () => {
  assert.equal(resolveWithinBase(BASE, '/home/u/project/../../../etc/passwd'), null);
});

test('rejects an absolute path outside the base', () => {
  assert.equal(resolveWithinBase(BASE, '/etc/passwd'), null);
});

test('rejects a sibling whose name has the base as a string prefix', () => {
  // The classic startsWith(base) bug: "/home/u/project-secrets" must NOT match
  // base "/home/u/project". The path.sep guard is what prevents this.
  assert.equal(resolveWithinBase(BASE, '/home/u/project-secrets/x'), null);
});

test('rejects relative paths', () => {
  assert.equal(resolveWithinBase(BASE, 'src/index.ts'), null);
});

test('rejects empty input', () => {
  assert.equal(resolveWithinBase(BASE, ''), null);
});

test('collapses traversal that stays within the base', () => {
  assert.equal(resolveWithinBase(BASE, '/home/u/project/src/../lib/a.ts'), '/home/u/project/lib/a.ts');
});

// resolveRelativeWithinBase — git mutation routes pass repo-relative filePaths
test('relative: accepts a normal relative file', () => {
  assert.equal(resolveRelativeWithinBase(BASE, 'src/index.ts'), `${BASE}/src/index.ts`);
});

test('relative: accepts an absolute path inside the base', () => {
  assert.equal(resolveRelativeWithinBase(BASE, `${BASE}/a.ts`), `${BASE}/a.ts`);
});

test('relative: rejects ../ traversal escape', () => {
  assert.equal(resolveRelativeWithinBase(BASE, '../../etc/passwd'), null);
});

test('relative: rejects an absolute path outside the base', () => {
  assert.equal(resolveRelativeWithinBase(BASE, '/etc/passwd'), null);
});

test('relative: rejects empty input', () => {
  assert.equal(resolveRelativeWithinBase(BASE, ''), null);
});
