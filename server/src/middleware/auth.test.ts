import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createAuthMiddleware } from './auth.js';
import type { AuthService } from '../services/AuthService.js';

const enforced = {
  exposed: true,
  enabled: true,
  enforced: true,
  validateToken: (t: string) => t === 'good',
} as unknown as AuthService;

async function serve(caseSensitive: boolean): Promise<{ base: string; close: () => Promise<void> }> {
  const app = express();
  if (caseSensitive) app.set('case sensitive routing', true);
  app.use(createAuthMiddleware(enforced));
  const r = express.Router();
  r.get('/', (_req, res) => { res.json({ secret: true }); });
  app.use('/api/sessions', r);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((res) => server.close(() => res())),
  };
}

// Regression: `/API/sessions` used to return 200 with no token, because routing
// ignored case while the gate's startsWith('/api/') did not.
for (const caseSensitive of [false, true]) {
  test(`path case cannot bypass auth (case-sensitive routing: ${caseSensitive})`, async () => {
    const { base, close } = await serve(caseSensitive);
    try {
      for (const p of ['/api/sessions', '/API/sessions', '/Api/Sessions', '/api/SESSIONS']) {
        const res = await fetch(base + p);
        assert.notEqual(res.status, 200, `${p} must not be served without a token`);
      }
      const authed = await fetch(base + '/api/sessions', { headers: { authorization: 'Bearer good' } });
      assert.equal(authed.status, 200);
    } finally {
      await close();
    }
  });
}

// S3: a tunnel Argus did not start itself must still enforce auth.
function statusWithHost(base: string, path: string, host: string): Promise<number> {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: { host } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); })
      .on('error', reject);
  });
}

async function serveWith(auth: AuthService): Promise<{ base: string; close: () => Promise<void> }> {
  const app = express();
  app.set('case sensitive routing', true);
  app.use(createAuthMiddleware(auth));
  app.get('/api/sessions', (_req, res) => { res.json({ secret: true }); });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((res) => server.close(() => res())) };
}

test('manual tunnel headers / Host enforce auth even when Argus never marked itself exposed', async () => {
  const { AuthService: RealAuth } = await import('../services/AuthService.js');
  const auth = new RealAuth();
  const { base, close } = await serveWith(auth);
  try {
    // Plain loopback, no password: open (local Electron keeps working).
    assert.equal((await fetch(base + '/api/sessions', { headers: { 'ngrok-skip-browser-warning': 'true' } })).status, 200);
    // Through a proxy/tunnel with no password: fail closed.
    for (const headers of [
      { 'x-forwarded-for': '203.0.113.9' },
      { 'x-forwarded-host': 'abc.ngrok-free.app' },
      { forwarded: 'for=203.0.113.9' },
      { 'ngrok-trace-id': 'abc' },
    ]) {
      const res = await fetch(base + '/api/sessions', { headers });
      assert.equal(res.status, 503, JSON.stringify(headers));
    }
    // fetch can't set Host; a tunnel that passes the public Host through does.
    assert.equal(await statusWithHost(base, '/api/sessions', 'abc.trycloudflare.com'), 503);
    // With a password: tunneled requests need the token.
    auth.setPassword('pw');
    const token = auth.generateToken();
    assert.equal((await fetch(base + '/api/sessions', { headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 401);
    assert.equal(
      (await fetch(base + '/api/sessions', { headers: { 'x-forwarded-for': '1.2.3.4', authorization: `Bearer ${token}` } })).status,
      200,
    );
  } finally {
    await close();
  }
});
