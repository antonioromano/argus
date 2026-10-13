import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from './AuthService.js';

test('disabled until a password is set', () => {
  const auth = new AuthService();
  assert.equal(auth.enabled, false);
  // verify always fails while disabled
  assert.equal(auth.verifyPassword('anything'), false);
});

test('verifyPassword accepts the correct password and rejects wrong ones', () => {
  const auth = new AuthService();
  auth.setPassword('s3cret-pass');
  assert.equal(auth.enabled, true);
  assert.equal(auth.verifyPassword('s3cret-pass'), true);
  assert.equal(auth.verifyPassword('s3cret-pas'), false);
  assert.equal(auth.verifyPassword(''), false);
  assert.equal(auth.verifyPassword('S3cret-pass'), false);
});

test('a fresh token validates; an unknown token does not', () => {
  const auth = new AuthService();
  auth.setPassword('pw');
  const token = auth.generateToken();
  assert.equal(auth.validateToken(token), true);
  assert.equal(auth.validateToken('not-a-real-token'), false);
});

test('clearAuth disables auth and invalidates issued tokens', () => {
  const auth = new AuthService();
  auth.setPassword('pw');
  const token = auth.generateToken();
  auth.clearAuth();
  assert.equal(auth.enabled, false);
  assert.equal(auth.validateToken(token), false);
});

test('password with a colon round-trips (hash format is salt:key)', () => {
  // Guards against a naive split(':') ever corrupting verification.
  const auth = new AuthService();
  auth.setPassword('a:b:c:d');
  assert.equal(auth.verifyPassword('a:b:c:d'), true);
  assert.equal(auth.verifyPassword('a:b:c'), false);
});

test('setPassword revokes every token issued under the previous password', () => {
  const auth = new AuthService();
  auth.setPassword('first-pass');
  const token = auth.generateToken();
  auth.setPassword('second-pass');
  assert.equal(auth.validateToken(token), false);
  const fresh = auth.generateToken();
  assert.equal(auth.validateToken(fresh), true);
});

test('onEnforcementChange fires on password set, exposure on, and clearAuth', () => {
  const auth = new AuthService();
  let calls = 0;
  const off = auth.onEnforcementChange(() => { calls++; });
  auth.setPassword('pw');
  auth.setExposed(true);
  auth.setExposed(true); // no change → no call
  auth.clearAuth();
  assert.equal(calls, 3);
  off();
  auth.setPassword('pw');
  assert.equal(calls, 3);
});
