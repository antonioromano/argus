import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBroadcast, runBroadcast, SlidingWindowLimiter, SessionInputQueue, BROADCAST_ENTER_DELAY_MS } from './broadcast.js';
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

/** A queue over a write log with manually fired timers. */
function queued() {
  const writes: Array<[string, string]> = [];
  const timers: Array<[() => void, number]> = [];
  const q = new SessionInputQueue((id, d) => { if (id === 'boom') throw new Error('gone'); writes.push([id, d]); }, (fn, ms) => { timers.push([fn, ms]); });
  const fire = () => { const t = timers.shift(); t?.[0](); };
  return { q, writes, timers, fire };
}

test('runBroadcast writes the text to live targets, then Enter after a pause', () => {
  const { q, writes, timers, fire } = queued();
  const res = runBroadcast({ ok: true, sessionIds: ['a', 'b', 'c'], text: 'rebase on main', enter: true }, (id) => id !== 'b', q);
  assert.deepEqual(res, { ok: true, sent: 2, skipped: 1 });
  assert.deepEqual(writes, [['a', 'rebase on main'], ['c', 'rebase on main']]);
  assert.deepEqual(timers.map((t) => t[1]), [BROADCAST_ENTER_DELAY_MS, BROADCAST_ENTER_DELAY_MS]);
  fire();
  fire();
  assert.deepEqual(writes.slice(2), [['a', '\r'], ['c', '\r']]);
  assert.equal(q.isPending('a'), false);
});

test('runBroadcast without Enter writes straight through', () => {
  const { q, writes, timers } = queued();
  runBroadcast({ ok: true, sessionIds: ['a'], text: 'y', enter: false }, () => true, q);
  assert.deepEqual(writes, [['a', 'y']]);
  assert.equal(timers.length, 0);
});

test('keystrokes and a second broadcast wait behind a pending Enter', () => {
  const { q, writes, fire } = queued();
  runBroadcast({ ok: true, sessionIds: ['a'], text: 'one', enter: true }, () => true, q);
  q.write('a', 'k'); // user types during the pause
  runBroadcast({ ok: true, sessionIds: ['a'], text: 'two', enter: true }, () => true, q);
  q.write('b', 'other session is unaffected');
  assert.deepEqual(writes.map((w) => w[1]), ['one', 'other session is unaffected']);
  fire();
  assert.deepEqual(writes.map((w) => w[1]), ['one', 'other session is unaffected', '\r', 'k', 'two']);
  fire();
  assert.deepEqual(writes.map((w) => w[1]).slice(-1), ['\r']);
  assert.equal(q.isPending('a'), false);
});

test('a write to a vanished session is swallowed and does not stall the queue', () => {
  const { q, writes } = queued();
  assert.doesNotThrow(() => q.write('boom', 'x'));
  q.write('a', 'y');
  assert.deepEqual(writes, [['a', 'y']]);
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
