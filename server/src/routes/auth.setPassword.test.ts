import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSetPassword, isLoopbackRequest } from './auth.js';

test('isLoopbackRequest recognizes loopback forms and rejects others', () => {
  assert.equal(isLoopbackRequest('127.0.0.1'), true);
  assert.equal(isLoopbackRequest('::1'), true);
  assert.equal(isLoopbackRequest('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackRequest('192.168.1.50'), false);
  assert.equal(isLoopbackRequest(undefined), false);
});

test('first-time setup from a local, non-proxied request is allowed', () => {
  const d = canSetPassword({
    remoteAddress: '127.0.0.1',
    proxied: false,
    alreadyEnabled: false,
    hasValidToken: false,
  });
  assert.deepEqual(d, { ok: true });
});

test('a non-loopback request is rejected (403)', () => {
  const d = canSetPassword({
    remoteAddress: '10.0.0.4',
    proxied: false,
    alreadyEnabled: false,
    hasValidToken: false,
  });
  assert.equal(d.ok, false);
  assert.equal((d as { status: number }).status, 403);
});

test('a loopback-but-proxied request is rejected — closes the ngrok tunnel bypass', () => {
  // ngrok forwards over loopback (remoteAddress === 127.0.0.1) but appends
  // X-Forwarded-* headers, surfaced here as proxied=true.
  const d = canSetPassword({
    remoteAddress: '127.0.0.1',
    proxied: true,
    alreadyEnabled: false,
    hasValidToken: false,
  });
  assert.equal(d.ok, false);
  assert.equal((d as { status: number }).status, 403);
});

test('changing an existing password without a valid token is rejected (409)', () => {
  const d = canSetPassword({
    remoteAddress: '127.0.0.1',
    proxied: false,
    alreadyEnabled: true,
    hasValidToken: false,
  });
  assert.equal(d.ok, false);
  assert.equal((d as { status: number }).status, 409);
});

test('changing an existing password WITH a valid token is allowed', () => {
  const d = canSetPassword({
    remoteAddress: '127.0.0.1',
    proxied: false,
    alreadyEnabled: true,
    hasValidToken: true,
  });
  assert.deepEqual(d, { ok: true });
});
