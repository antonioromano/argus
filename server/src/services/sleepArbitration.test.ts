import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SleepPreventionService } from './SleepPreventionService.js';
import type { SleepBlocker } from './SleepPreventionService.js';

/**
 * The regression the arbitration refactor exists for. Before it, SessionManager
 * and NgrokService each owned a private SleepPreventionService — two independent
 * OS blockers, neither aware of the other. Adding a third caller (the manual
 * keep-awake window) on a shared latch would have meant "Turn off" releasing a
 * blocker that a running shell still needed, and a shell exiting cancelling a
 * manual window the user had just armed.
 */

class FakeBlocker implements SleepBlocker {
  starts = 0;
  stops = 0;
  private _active = false;
  async start(): Promise<void> { this.starts++; this._active = true; }
  async stop(): Promise<void> { this.stops++; this._active = false; }
  get active(): boolean { return this._active; }
}

test('a manual window survives the last running shell exiting', async () => {
  const blocker = new FakeBlocker();
  const sleep = new SleepPreventionService(blocker);

  await sleep.acquire('manual');   // user armed 2 hours
  await sleep.acquire('sessions'); // a shell started
  await sleep.release('sessions'); // that shell exited

  assert.equal(sleep.active, true, 'manual window must still hold the blocker');
  assert.deepEqual(sleep.heldBy, ['manual']);
});

test('turning the manual window off does not release a blocker shells still want', async () => {
  const blocker = new FakeBlocker();
  const sleep = new SleepPreventionService(blocker);

  await sleep.acquire('sessions');
  await sleep.acquire('manual');
  await sleep.release('manual');   // user hit "Turn off"

  assert.equal(sleep.active, true, 'running shells must still hold the blocker');
  assert.deepEqual(sleep.heldBy, ['sessions']);
});

test('an ngrok tunnel and a manual window are independent holders', async () => {
  const blocker = new FakeBlocker();
  const sleep = new SleepPreventionService(blocker);

  await sleep.acquire('ngrok');
  await sleep.acquire('manual');
  await sleep.release('ngrok');
  assert.equal(sleep.active, true);

  await sleep.release('manual');
  assert.equal(sleep.active, false);
  assert.equal(blocker.starts, 1, 'one OS blocker for the whole sequence');
  assert.equal(blocker.stops, 1);
});
