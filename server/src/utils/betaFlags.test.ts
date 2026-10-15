import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBetaEnabled } from './betaFlags.js';

test('isBetaEnabled is on only for an explicit true', () => {
  assert.equal(isBetaEnabled({ betaWorktreeLifecycle: true }, 'betaWorktreeLifecycle'), true);
  assert.equal(isBetaEnabled({ betaWorktreeLifecycle: false }, 'betaWorktreeLifecycle'), false);
  assert.equal(isBetaEnabled({}, 'betaWorktreeLifecycle'), false);
  assert.equal(isBetaEnabled(null, 'betaWorktreeLifecycle'), false);
  assert.equal(isBetaEnabled({ betaWorktreeLifecycle: 'yes' } as never, 'betaWorktreeLifecycle'), false);
});
