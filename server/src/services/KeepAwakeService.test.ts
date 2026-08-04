import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KeepAwakeStatus } from '@argus/shared';
import { KeepAwakeService, isKeepAwakeDuration } from './KeepAwakeService.js';
import { SleepPreventionService } from './SleepPreventionService.js';
import type { SleepBlocker } from './SleepPreventionService.js';

class FakeBlocker implements SleepBlocker {
  starts = 0;
  stops = 0;
  private _active = false;
  async start(): Promise<void> { this.starts++; this._active = true; }
  async stop(): Promise<void> { this.stops++; this._active = false; }
  get active(): boolean { return this._active; }
}

/**
 * Captures scheduled callbacks so expiry is triggered explicitly. `mock.timers`
 * is deliberately avoided — it hangs on this codebase's async awaits.
 */
function fakeScheduler() {
  const pending: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const schedule = (fn: () => void, ms: number) => {
    const entry = { fn, ms, cancelled: false };
    pending.push(entry);
    return () => { entry.cancelled = true; };
  };
  const fireLast = async () => {
    const entry = pending[pending.length - 1];
    assert.ok(entry, 'nothing scheduled');
    assert.equal(entry.cancelled, false, 'last scheduled timer was cancelled');
    entry.fn();
    await new Promise((r) => setImmediate(r)); // let the async disarm settle
  };
  return { pending, schedule, fireLast };
}

const START = 1_000_000;

function build() {
  const blocker = new FakeBlocker();
  const sleep = new SleepPreventionService(blocker);
  const sched = fakeScheduler();
  const svc = new KeepAwakeService(sleep, () => START, sched.schedule);
  return { blocker, sleep, sched, svc };
}

test('starts off', () => {
  const { svc } = build();
  assert.deepEqual(svc.status, { active: false, expiresAt: null, indefinite: false });
});

test('arm acquires the blocker and reports the expiry', async () => {
  const { svc, blocker, sleep } = build();

  const status = await svc.arm(30 * 60_000);

  assert.deepEqual(status, { active: true, expiresAt: START + 30 * 60_000, indefinite: false });
  assert.equal(blocker.starts, 1);
  assert.deepEqual(sleep.heldBy, ['manual']);
});

test('expiry releases the blocker and notifies', async () => {
  const { svc, blocker, sleep, sched } = build();
  const seen: KeepAwakeStatus[] = [];
  svc.onChange((s) => seen.push(s));

  await svc.arm(5 * 60_000);
  assert.equal(sched.pending[0].ms, 5 * 60_000);

  await sched.fireLast();

  assert.deepEqual(svc.status, { active: false, expiresAt: null, indefinite: false });
  assert.equal(blocker.stops, 1);
  assert.deepEqual(sleep.heldBy, []);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].active, true);
  assert.equal(seen[1].active, false);
});

test('disarm before expiry cancels the timer', async () => {
  const { svc, sched, blocker } = build();

  await svc.arm(60 * 60_000);
  await svc.disarm();

  assert.equal(sched.pending[0].cancelled, true);
  assert.equal(blocker.stops, 1);
  assert.equal(svc.status.active, false);
});

test('re-arm replaces the window instead of stacking', async () => {
  const { svc, sched, blocker } = build();

  await svc.arm(5 * 60_000);
  const status = await svc.arm(2 * 60 * 60_000);

  assert.equal(sched.pending.length, 2);
  assert.equal(sched.pending[0].cancelled, true, 'the 5m timer must be cancelled');
  assert.equal(sched.pending[1].cancelled, false);
  assert.equal(status.expiresAt, START + 2 * 60 * 60_000);
  assert.equal(blocker.starts, 1, 'still one OS blocker');
  assert.equal(blocker.stops, 0);
});

test('indefinite never schedules an expiry', async () => {
  const { svc, sched } = build();

  const status = await svc.arm(null);

  assert.deepEqual(status, { active: true, expiresAt: null, indefinite: true });
  assert.equal(sched.pending.length, 0);
});

test('a failing blocker leaves the service off', async () => {
  const blocker = new FakeBlocker();
  blocker.start = async () => { throw new Error('powerSaveBlocker unavailable'); };
  const sleep = new SleepPreventionService(blocker);
  const svc = new KeepAwakeService(sleep, () => START, () => () => {});

  await assert.rejects(() => svc.arm(5 * 60_000), /unavailable/);
  assert.deepEqual(svc.status, { active: false, expiresAt: null, indefinite: false });
  assert.deepEqual(sleep.heldBy, []);
});

test('shutdown cancels the timer and releases', async () => {
  const { svc, sched, blocker } = build();

  await svc.arm(4 * 60 * 60_000);
  await svc.shutdown();

  assert.equal(sched.pending[0].cancelled, true);
  assert.equal(blocker.stops, 1);
});

test('isKeepAwakeDuration accepts the allowlist and null only', () => {
  for (const ms of [5, 15, 30, 60, 120, 240].map((m) => m * 60_000)) {
    assert.equal(isKeepAwakeDuration(ms), true, `${ms} should be allowed`);
  }
  assert.equal(isKeepAwakeDuration(null), true);
  assert.equal(isKeepAwakeDuration(0), false);
  assert.equal(isKeepAwakeDuration(-60_000), false);
  assert.equal(isKeepAwakeDuration(7 * 60_000), false);
  assert.equal(isKeepAwakeDuration(8 * 60 * 60_000), false);
  assert.equal(isKeepAwakeDuration('300000'), false);
  assert.equal(isKeepAwakeDuration(undefined), false);
  assert.equal(isKeepAwakeDuration(Number.POSITIVE_INFINITY), false);
  assert.equal(isKeepAwakeDuration(Number.NaN), false);
});
