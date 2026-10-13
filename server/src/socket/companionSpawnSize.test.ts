import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companionSpawnSize } from './handler.js';

test('companion shell spawns at the joining client size when sane', () => {
  assert.deepEqual(companionSpawnSize({ cols: 80, rows: 24 }), [80, 24]);
});

test('companion shell falls back to 120x30 for a missing or hostile size', () => {
  for (const bad of [undefined, null, {}, { cols: 100000, rows: 24 }, { cols: 80.5, rows: 24 }, { cols: '80', rows: 24 }, { cols: 1, rows: 1 }]) {
    assert.deepEqual(companionSpawnSize(bad), [120, 30], JSON.stringify(bad));
  }
});
