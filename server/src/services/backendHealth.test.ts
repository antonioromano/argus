import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BackendHealth } from '@argus/shared';
import { BackendHealthTracker } from './backendHealth.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tracker() {
  const seen: BackendHealth['state'][] = [];
  const t = new BackendHealthTracker('daemon', (h) => seen.push(h.state), { reconnectingAfterMs: 20, downAfterMs: 60 });
  return { t, seen };
}

test('a flap shorter than the debounce emits nothing', async () => {
  const { t, seen } = tracker();
  t.handle('disconnected');
  await sleep(5);
  t.handle('connected');
  await sleep(80);
  assert.deepEqual(seen, []);
  assert.equal(t.current().state, 'ok');
});

test('a longer drop goes reconnecting, then down, then ok on reconnect', async () => {
  const { t, seen } = tracker();
  t.handle('disconnected');
  await sleep(35);
  assert.deepEqual(seen, ['reconnecting']);
  await sleep(50);
  assert.deepEqual(seen, ['reconnecting', 'down']);
  t.handle('connected');
  assert.deepEqual(seen, ['reconnecting', 'down', 'ok']);
});

test('repeated disconnect events do not restart the clock or emit twice', async () => {
  const { t, seen } = tracker();
  t.handle('disconnected');
  await sleep(10);
  t.handle('disconnected');
  await sleep(20);
  assert.deepEqual(seen, ['reconnecting']);
  t.dispose();
});

test('a version mismatch drains and stays drained across reconnects', async () => {
  const { t, seen } = tracker();
  t.handle('versionMismatch');
  t.handle('connected');
  t.handle('disconnected');
  await sleep(80);
  assert.deepEqual(seen, ['drain']);
  assert.deepEqual(t.current(), { kind: 'daemon', state: 'drain' });
});

test('connected while ok emits nothing', () => {
  const { t, seen } = tracker();
  t.handle('connected');
  assert.deepEqual(seen, []);
});
