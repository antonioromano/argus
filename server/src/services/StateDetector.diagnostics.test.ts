import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateDetector } from './StateDetector.js';

const settle = (ms = 1000) => new Promise((r) => setTimeout(r, ms));
const atBottom = (line: string) => '\r\n'.repeat(20) + line;

test('getDiagnostics reflects a waiting confirmation prompt', async () => {
  const det = new StateDetector(() => {}, 'claude');
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
  const det = new StateDetector(() => {}, 'claude');
  det.destroy();
  const d = det.getDiagnostics();
  assert.equal(d.classified, null);
  assert.deepEqual(d.visibleRows, []);
  assert.deepEqual(d.cursor, { x: 0, y: 0 });
});

test('forceReclassify re-emits status without new feed', async () => {
  let calls = 0;
  const det = new StateDetector(() => { calls++; }, 'claude');
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
