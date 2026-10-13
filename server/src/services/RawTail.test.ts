import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RawTail } from './RawTail.js';

test('RawTail keeps the newest bytes and drops whole old chunks', () => {
  const t = new RawTail(10);
  t.push('aaaa');
  t.push('bbbb');
  t.push('cccc');
  // 12 chars held: dropping 'aaaa' would leave 8 < 10, so it stays.
  assert.equal(t.tail(), 'aabbbbcccc');
  t.push('dddd');
  // Now 'aaaa' can go (12 left >= 10).
  assert.equal(t.size, 12);
  assert.equal(t.tail(), 'bbccccdddd');
  assert.equal(t.tail(4), 'dddd');
});

test('RawTail holds a single oversized chunk and clears', () => {
  const t = new RawTail(4);
  t.push('0123456789');
  assert.equal(t.tail(), '6789');
  t.push('');
  t.clear();
  assert.equal(t.size, 0);
  assert.equal(t.tail(), '');
});
