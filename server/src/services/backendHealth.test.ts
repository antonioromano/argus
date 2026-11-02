import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { BackendHealth } from '@argus/shared';
import { BackendHealthTracker } from './backendHealth.js';

// Mock timers: the debounce windows are tens of ms, and a real sleep under a
// loaded verify run overshoots them (a 30ms sleep took 67ms and fired 'down').

function tracker(ctx: TestContext) {
  ctx.mock.timers.enable({ apis: ['setTimeout'] });
  const seen: BackendHealth['state'][] = [];
  const health = new BackendHealthTracker('daemon', (h) => seen.push(h.state), { reconnectingAfterMs: 20, downAfterMs: 60 });
  return { health, seen };
}

test('a flap shorter than the debounce emits nothing', (t) => {
  const { health, seen } = tracker(t);
  health.handle('disconnected');
  t.mock.timers.tick(5);
  health.handle('connected');
  t.mock.timers.tick(80);
  assert.deepEqual(seen, []);
  assert.equal(health.current().state, 'ok');
});

test('a longer drop goes reconnecting, then down, then ok on reconnect', (t) => {
  const { health, seen } = tracker(t);
  health.handle('disconnected');
  t.mock.timers.tick(35);
  assert.deepEqual(seen, ['reconnecting']);
  t.mock.timers.tick(50);
  assert.deepEqual(seen, ['reconnecting', 'down']);
  health.handle('connected');
  assert.deepEqual(seen, ['reconnecting', 'down', 'ok']);
});

test('repeated disconnect events do not restart the clock or emit twice', (t) => {
  const { health, seen } = tracker(t);
  health.handle('disconnected');
  t.mock.timers.tick(10);
  health.handle('disconnected');
  t.mock.timers.tick(20);
  assert.deepEqual(seen, ['reconnecting']);
  health.dispose();
});

test('a version mismatch drains and stays drained across reconnects', (t) => {
  const { health, seen } = tracker(t);
  health.handle('versionMismatch');
  health.handle('connected');
  health.handle('disconnected');
  t.mock.timers.tick(80);
  assert.deepEqual(seen, ['drain']);
  assert.deepEqual(health.current(), { kind: 'daemon', state: 'drain' });
});

test('connected while ok emits nothing', (t) => {
  const { health, seen } = tracker(t);
  health.handle('connected');
  assert.deepEqual(seen, []);
});
