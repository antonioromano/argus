import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMenuTarget } from './menuTarget.js';

test('an Electron window with OS focus wins', () => {
  assert.equal(resolveMenuTarget('focused', ['overlay-owner']), 'focused');
});

test('no focused Electron window -> owner of the key native overlay', () => {
  // A native tile is a child NSWindow: while it is key, getFocusedWindow() is null.
  assert.equal(resolveMenuTarget(null, ['second-window']), 'second-window');
});

test('skips overlay owners that no longer resolve to a window', () => {
  assert.equal(resolveMenuTarget(null, [null, undefined, 'live']), 'live');
});

test('nothing focused and no key overlay -> null (caller falls back to main)', () => {
  assert.equal(resolveMenuTarget(null, []), null);
});
