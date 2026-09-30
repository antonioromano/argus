import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldCollidingAcceleratorsBeEnabled } from './menuAcceleratorGating.js';

test('editor focused -> colliding items disabled', () => {
  assert.equal(shouldCollidingAcceleratorsBeEnabled(true), false);
});

test('editor blurred -> colliding items enabled', () => {
  assert.equal(shouldCollidingAcceleratorsBeEnabled(false), true);
});

test('never reported (undefined) -> fail safe, enabled', () => {
  assert.equal(shouldCollidingAcceleratorsBeEnabled(undefined), true);
});
