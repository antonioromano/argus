import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SleepPreventionService } from './SleepPreventionService.js';
import type { SleepBlocker } from './SleepPreventionService.js';

/**
 * Fake OS mechanism. Injected so the suite never spawns a real `caffeinate`
 * (which would outlive the test and actually keep the machine awake).
 */
class FakeBlocker implements SleepBlocker {
  starts = 0;
  stops = 0;
  failNext = false;
  private _active = false;

  async start(): Promise<void> {
    if (this.failNext) { this.failNext = false; throw new Error('blocker unavailable'); }
    this.starts++;
    this._active = true;
  }

  async stop(): Promise<void> {
    this.stops++;
    this._active = false;
  }

  get active(): boolean {
    return this._active;
  }
}

test('first acquire starts the blocker, extra holders do not restart it', async () => {
  const blocker = new FakeBlocker();
  const svc = new SleepPreventionService(blocker);

  await svc.acquire('sessions');
  await svc.acquire('ngrok');

  assert.equal(blocker.starts, 1);
  assert.equal(svc.active, true);
  assert.deepEqual(svc.heldBy.sort(), ['ngrok', 'sessions']);
});

test('releasing one of two holders keeps the blocker up', async () => {
  const blocker = new FakeBlocker();
  const svc = new SleepPreventionService(blocker);

  await svc.acquire('sessions');
  await svc.acquire('manual');
  await svc.release('sessions');

  assert.equal(blocker.stops, 0);
  assert.equal(svc.active, true);
  assert.deepEqual(svc.heldBy, ['manual']);
});

test('releasing the last holder stops the blocker', async () => {
  const blocker = new FakeBlocker();
  const svc = new SleepPreventionService(blocker);

  await svc.acquire('manual');
  await svc.release('manual');

  assert.equal(blocker.stops, 1);
  assert.equal(svc.active, false);
  assert.deepEqual(svc.heldBy, []);
});

test('acquire is idempotent per reason', async () => {
  const blocker = new FakeBlocker();
  const svc = new SleepPreventionService(blocker);

  await svc.acquire('sessions');
  await svc.acquire('sessions');
  await svc.release('sessions');

  assert.equal(blocker.starts, 1);
  assert.equal(blocker.stops, 1);
  assert.equal(svc.active, false);
});

test('releasing a reason that never acquired is a no-op', async () => {
  const blocker = new FakeBlocker();
  const svc = new SleepPreventionService(blocker);

  await svc.acquire('sessions');
  await svc.release('manual');

  assert.equal(blocker.stops, 0);
  assert.equal(svc.active, true);
});

test('a failing blocker does not leave a phantom holder', async () => {
  const blocker = new FakeBlocker();
  blocker.failNext = true;
  const svc = new SleepPreventionService(blocker);

  await assert.rejects(() => svc.acquire('manual'), /blocker unavailable/);
  assert.deepEqual(svc.heldBy, []);
  assert.equal(svc.active, false);
});
