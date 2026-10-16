import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlanPartOn } from './usageMeter.js';

test('the plan part (status line wrapper) follows usageMeterParts; absent or malformed = default on', () => {
  assert.equal(isPlanPartOn({}), true);
  assert.equal(isPlanPartOn(null), true);
  assert.equal(isPlanPartOn({ usageMeterParts: 'x' as never }), true);
  const parts = (plan: boolean) => [{ id: 'ctx', on: true }, { id: 'plan', on: plan }, { id: 'tok', on: false }, { id: 'model', on: false }] as const;
  assert.equal(isPlanPartOn({ usageMeterParts: [...parts(false)] }), false);
  assert.equal(isPlanPartOn({ usageMeterParts: [...parts(true)] }), true);
});
