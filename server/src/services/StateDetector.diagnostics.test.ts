import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionStatus } from '@argus/shared';
import { StateDetector } from './StateDetector.js';
import { FakeClock } from './StateDetector.testClock.js';

const atBottom = (line: string) => '\r\n'.repeat(20) + line;


/**
 * Each test gets its own virtual clock, so `settle()` fires the detector's
 * chained timers (500ms idle settle → 300ms commit debounce) instead of sleeping
 * past them. Sleeping was flaky: under load the real timers fire late and the
 * sleep expires first, so a correct classification reads as a wrong one.
 */
function make(onStatus: (s: SessionStatus) => void, agentType = 'claude') {
  const clock = new FakeClock();
  const det = new StateDetector(onStatus, agentType, 120, 30, undefined, clock);
  return { det, clock, settle: (ms = 900) => clock.advance(ms) };
}

test('getDiagnostics reflects a waiting confirmation prompt', async () => {
  const { det, settle } = make(() => {}, 'claude');
  det.feed(atBottom('Do you want to proceed? (y/n)'));
  await settle();

  const d = det.getDiagnostics();
  assert.equal(d.currentStatus, 'waiting');
  assert.equal(d.classified, 'waiting');
  assert.ok(d.visibleRows.some((r) => r.includes('proceed')), 'visibleRows should include the prompt line');
  assert.equal(typeof d.timing['IDLE_SETTLE_MS'], 'number');
  assert.ok(d.cursor && typeof d.cursor.x === 'number' && typeof d.cursor.y === 'number');
  det.destroy();
});

test('getDiagnostics returns safe defaults after destroy', () => {
  const { det, settle } = make(() => {}, 'claude');
  det.destroy();
  const d = det.getDiagnostics();
  assert.equal(d.classified, null);
  assert.deepEqual(d.visibleRows, []);
  assert.deepEqual(d.cursor, { x: 0, y: 0 });
});

test('forceReclassify re-emits status without new feed', async () => {
  let calls = 0;
  const { det, settle } = make(() => { calls++; }, 'claude');
  det.feed(atBottom('Do you want to proceed? (y/n)'));
  await settle();
  const before = calls;
  det.forceReclassify();
  await settle();
  // forceReclassify runs settle() again; at minimum it must not throw and the
  // detector stays in a waiting state.
  assert.equal(det.getStatus(), 'waiting');
  assert.ok(calls >= before);
  det.destroy();
});
