import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIdentity } from './sessionIdentity.js';

test('accepts a single emoji, a ZWJ sequence and a flag', () => {
  assert.deepEqual(validateIdentity({ emoji: '🦊' }), { emoji: '🦊' });
  assert.deepEqual(validateIdentity({ emoji: '👩‍💻' }), { emoji: '👩‍💻' });
  assert.deepEqual(validateIdentity({ emoji: '🇮🇹' }), { emoji: '🇮🇹' });
});

test('refuses text, two emoji, a plain letter and anything over 16 units', () => {
  for (const emoji of ['ab', '🦊🦊', 'x', '👨‍👩‍👧‍👦👨‍👩‍👧‍👦', '1']) {
    assert.ok('error' in validateIdentity({ emoji }), `expected ${emoji} to be refused`);
  }
});

test('accepts a palette key and refuses anything else', () => {
  assert.deepEqual(validateIdentity({ color: 'blue' }), { color: 'blue' });
  assert.ok('error' in validateIdentity({ color: '#fff' }));
  assert.ok('error' in validateIdentity({ color: 'toString' }));
  assert.ok('error' in validateIdentity({ color: 3 }));
});

test('null and empty string clear', () => {
  assert.deepEqual(validateIdentity({ color: null, emoji: null }), { color: null, emoji: null });
  assert.deepEqual(validateIdentity({ emoji: '' }), { emoji: null });
});

test('an empty or malformed body is refused', () => {
  assert.ok('error' in validateIdentity({}));
  assert.ok('error' in validateIdentity(null));
  assert.ok('error' in validateIdentity([]));
});
