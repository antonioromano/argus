import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordStrength } from './passwordStrength.js';

test('rejects passwords shorter than 12 characters', () => {
  assert.match(validatePasswordStrength('short')!, /at least 12 characters/);
  assert.match(validatePasswordStrength('a'.repeat(11))!, /at least 12 characters/);
  assert.match(validatePasswordStrength('')!, /at least 12 characters/);
});

test('accepts a 12-character unique password (boundary)', () => {
  assert.equal(validatePasswordStrength('a1b2c3d4e5f6'), null);
});

test('rejects common passwords that meet the length, case-insensitively', () => {
  assert.match(validatePasswordStrength('password123456')!, /too common/);
  assert.match(validatePasswordStrength('PassWord123456')!, /too common/);
});

test('accepts a long passphrase', () => {
  assert.equal(validatePasswordStrength('correct-horse-battery-staple-9'), null);
});
