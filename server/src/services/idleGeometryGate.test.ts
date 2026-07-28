import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdleGeometryGate } from './idleGeometryGate.js';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a viewer that comes back within the grace window costs no resize at all', async () => {
  const applied: string[] = [];
  const gate = new IdleGeometryGate(60, (id) => applied.push(id));

  gate.schedule('s1');
  await tick(20);
  gate.cancel('s1'); // rejoin

  await tick(80);
  assert.deepEqual(applied, [], 'a transient disconnect must not SIGWINCH the agent');
  gate.dispose();
});

test('a session nobody comes back to still gets the idle floor, just late', async () => {
  const applied: string[] = [];
  const gate = new IdleGeometryGate(30, (id) => applied.push(id));

  gate.schedule('s2');
  assert.deepEqual(applied, [], 'not applied synchronously');

  await tick(90);
  assert.deepEqual(applied, ['s2']);
  gate.dispose();
});

test('leave/disconnect churn keeps the original deadline instead of deferring forever', async () => {
  const applied: string[] = [];
  const gate = new IdleGeometryGate(150, (id) => applied.push(id));

  gate.schedule('s3');
  for (let i = 0; i < 4; i++) {
    await tick(15); // repeated leaves inside the window, e.g. tiles closing in sequence
    gate.schedule('s3');
  }
  assert.deepEqual(applied, [], 'still inside the original window');

  await tick(200);
  assert.deepEqual(applied, ['s3'], 'exactly one idle resize, on the first deadline');
  gate.dispose();
});

test('dispose drops pending work so a shutting-down manager resizes nothing', async () => {
  const applied: string[] = [];
  const gate = new IdleGeometryGate(20, (id) => applied.push(id));
  gate.schedule('s4');
  assert.equal(gate.isPending('s4'), true);
  gate.dispose();

  await tick(60);
  assert.deepEqual(applied, []);
});
