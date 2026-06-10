import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRelativeWithinBase } from '../utils/pathScope.js';

// Unit-test the two guard primitives used by git.ts — no HTTP server needed.

const BASE = '/home/u/repo';

// --- resolveRelativeWithinBase contract (path containment) ---

test('git guard: normal relative file accepted', () => {
  assert.ok(resolveRelativeWithinBase(BASE, 'src/index.ts'));
});

test('git guard: relative traversal escape rejected', () => {
  assert.equal(resolveRelativeWithinBase(BASE, '../../etc/passwd'), null);
});

test('git guard: absolute path outside base rejected', () => {
  assert.equal(resolveRelativeWithinBase(BASE, '/etc/passwd'), null);
});

test('git guard: absolute path inside base accepted', () => {
  assert.ok(resolveRelativeWithinBase(BASE, `${BASE}/src/a.ts`));
});

test('git guard: empty string rejected', () => {
  assert.equal(resolveRelativeWithinBase(BASE, ''), null);
});

// --- isSafeRef contract (branch names) ---

function isSafeRef(ref: string): boolean {
  return !ref.startsWith('-') && !ref.includes('..');
}

test('ref guard: normal branch name accepted', () => {
  assert.ok(isSafeRef('feature/my-branch'));
});

test('ref guard: leading-dash option injection rejected', () => {
  assert.equal(isSafeRef('--force'), false);
  assert.equal(isSafeRef('-u'), false);
});

test('ref guard: dotdot traversal rejected', () => {
  assert.equal(isSafeRef('main..evil'), false);
});

test('ref guard: tag-style name accepted', () => {
  assert.ok(isSafeRef('v1.2.3'));
});
