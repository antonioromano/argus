import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBroadcast, runBroadcast, SlidingWindowLimiter, BROADCAST_ENTER_DELAY_MS } from './broadcast.js';
import { BROADCAST_MAX_TARGETS, BROADCAST_MAX_TEXT } from '../constants/broadcast.js';

const known = new Set(['a', 'b', 'c']);
const exists = (id: string) => known.has(id);
const v = (p: unknown) => validateBroadcast(p, exists);

test('accepts a valid request and dedupes ids', () => {
  assert.deepEqual(v({ sessionIds: ['a', 'b', 'a'], text: '/compact', enter: true }), {
    ok: true, sessionIds: ['a', 'b'], text: '/compact', enter: true,
  });
  assert.deepEqual(v({ sessionIds: ['c'], text: '', enter: true }), { ok: true, sessionIds: ['c'], text: '', enter: true });
});

test('rejects malformed payloads and unknown sessions', () => {
  for (const bad of [null, 'x', 42, {}, { sessionIds: [] , text: 'x' }, { sessionIds: 'a', text: 'x' }, { sessionIds: [1], text: 'x' }]) {
    assert.equal(v(bad).ok, false, JSON.stringify(bad));
  }
  const r = v({ sessionIds: ['a', 'zzz'], text: 'hi' });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /Unknown session: zzz/);
});

test('enforces the target and length caps', () => {
  const many = Array.from({ length: BROADCAST_MAX_TARGETS + 1 }, (_, i) => `s${i}`);
  assert.equal(validateBroadcast({ sessionIds: many, text: 'x' }, () => true).ok, false);
  assert.equal(v({ sessionIds: ['a'], text: 'x'.repeat(BROADCAST_MAX_TEXT) }).ok, true);
  assert.equal(v({ sessionIds: ['a'], text: 'x'.repeat(BROADCAST_MAX_TEXT + 1) }).ok, false);
});

test('refuses control characters (escape sequences, newlines) but allows tabs', () => {
  for (const text of ['a\nb', 'a\rb', '\x1b[2J', '\x03', 'x\x7f']) {
    assert.equal(v({ sessionIds: ['a'], text }).ok, false, JSON.stringify(text));
  }
  assert.equal(v({ sessionIds: ['a'], text: 'a\tb ünïcødé ✓' }).ok, true);
});

test('nothing to send without text or enter', () => {
  assert.equal(v({ sessionIds: ['a'], text: '' }).ok, false);
  assert.equal(v({ sessionIds: ['a'], text: '', enter: 'yes' }).ok, false, 'enter must be literally true');
});

test('runBroadcast writes the text to live targets, then Enter after a delay', () => {
  const writes: Array<[string, string]> = [];
  const scheduled: Array<[() => void, number]> = [];
  const res = runBroadcast(
    { ok: true, sessionIds: ['a', 'b', 'c'], text: 'rebase on main', enter: true },
    { isLive: (id) => id !== 'b', write: (id, d) => { writes.push([id, d]); } },
    (fn, ms) => { scheduled.push([fn, ms]); },
  );
  assert.deepEqual(res, { ok: true, sent: 2, skipped: 1 });
  assert.deepEqual(writes, [['a', 'rebase on main'], ['c', 'rebase on main']]);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]![1], BROADCAST_ENTER_DELAY_MS);
  scheduled[0]![0]();
  assert.deepEqual(writes.slice(2), [['a', '\r'], ['c', '\r']]);
});

test('runBroadcast without Enter sends only the text; a throwing write counts as skipped', () => {
  const writes: string[] = [];
  const res = runBroadcast(
    { ok: true, sessionIds: ['a', 'b'], text: 'y', enter: false },
    { isLive: () => true, write: (id) => { if (id === 'b') throw new Error('gone'); writes.push(id); } },
    () => assert.fail('no Enter scheduled'),
  );
  assert.deepEqual(res, { ok: true, sent: 1, skipped: 1 });
  assert.deepEqual(writes, ['a']);
});

test('SlidingWindowLimiter allows max per window, then recovers', () => {
  let t = 0;
  const l = new SlidingWindowLimiter(2, 1000, () => t);
  assert.equal(l.take(), true);
  assert.equal(l.take(), true);
  assert.equal(l.take(), false);
  t = 1001;
  assert.equal(l.take(), true);
});
