import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { LoginRateLimiter, loginClientKey } from './LoginRateLimiter.js';
import { AuthService } from './AuthService.js';
import { createAuthRoutes } from '../routes/auth.js';

test('loginClientKey: a local request keys on the peer address', () => {
  assert.equal(loginClientKey({ host: '127.0.0.1:5757' }, '127.0.0.1'), '127.0.0.1');
});

test('loginClientKey: behind a tunnel, keys on the LAST X-Forwarded-For hop (the one the edge added)', () => {
  assert.equal(loginClientKey({ 'x-forwarded-for': '203.0.113.9' }, '127.0.0.1'), 'fwd:203.0.113.9');
  // The client prepended a fake entry; the edge appended the real one.
  assert.equal(loginClientKey({ 'x-forwarded-for': '10.0.0.1, 198.51.100.7' }, '127.0.0.1'), 'fwd:198.51.100.7');
  assert.equal(loginClientKey({ forwarded: 'for=192.0.2.60;proto=https' }, '127.0.0.1'), 'fwd:192.0.2.60');
  assert.equal(loginClientKey({ 'ngrok-trace-id': 'x' }, '127.0.0.1'), 'fwd:unknown');
});

test('per-client lockout does not lock out a different client', () => {
  const l = new LoginRateLimiter({ maxAttempts: 3, globalMaxAttempts: 100 });
  for (let i = 0; i < 3; i++) l.recordFailure('fwd:a');
  assert.match(l.check('fwd:a') ?? '', /Too many failed attempts/);
  assert.equal(l.check('fwd:b'), null);
});

test('the global cap pauses every login once total failures reach it', () => {
  let t = 0;
  const l = new LoginRateLimiter({ maxAttempts: 100, globalMaxAttempts: 5, lockoutMs: 1000, now: () => t });
  for (let i = 0; i < 5; i++) l.recordFailure(`fwd:${i}`);
  assert.notEqual(l.check('fwd:fresh'), null);
  t = 1001;
  assert.equal(l.check('fwd:fresh'), null, 'lockout lifts');
});

test('a successful login resets only that client', () => {
  const l = new LoginRateLimiter({ maxAttempts: 2 });
  l.recordFailure('a');
  l.reset('a');
  l.recordFailure('a');
  assert.equal(l.check('a'), null);
});

// S12 end to end: all tunnel users used to share the 127.0.0.1 bucket, so one
// attacker's wrong guesses locked the owner out.
test('/api/auth/login: one tunnel client locked out, another still gets to try', async () => {
  const auth = new AuthService();
  auth.setPassword('the-real-password-1');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRoutes(auth, new LoginRateLimiter({ maxAttempts: 3 })));
  const server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  const login = (password: string, xff: string) => fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
    body: JSON.stringify({ password }),
  });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await login('wrong', '203.0.113.9')).status, 401);
    assert.equal((await login('the-real-password-1', '203.0.113.9')).status, 429);
    assert.equal((await login('the-real-password-1', '198.51.100.7')).status, 200);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
