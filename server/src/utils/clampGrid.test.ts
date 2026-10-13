import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampGrid } from './clampGrid.js';

test('clampGrid passes normal sizes through', () => {
  assert.deepEqual(clampGrid(120, 30), { cols: 120, rows: 30 });
});

test('clampGrid bounds hostile or broken sizes', () => {
  assert.deepEqual(clampGrid(100000, 100000), { cols: 1000, rows: 500 });
  assert.deepEqual(clampGrid(0, -5), { cols: 2, rows: 2 });
  assert.deepEqual(clampGrid(80.9, 24.2), { cols: 80, rows: 24 });
  assert.equal(clampGrid(NaN, 10), null);
  assert.equal(clampGrid(Infinity, 10), null);
  assert.equal(clampGrid('80', 24), null);
  assert.equal(clampGrid(undefined, undefined), null);
});
