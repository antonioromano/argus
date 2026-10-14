import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createNgrokRoutes } from './ngrok.js';
import { AuthService } from '../services/AuthService.js';
import type { NgrokService } from '../services/NgrokService.js';

type Status = ReturnType<NgrokService['getStatus']>;

async function serve(ngrok: Partial<NgrokService>, auth = new AuthService()) {
  const app = express();
  app.use(express.json());
  app.use('/api/ngrok', createNgrokRoutes(ngrok as NgrokService, auth));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as AddressInfo;
  const call = (method: string, route: string, body?: unknown) => fetch(`http://127.0.0.1:${port}/api/ngrok${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { auth, call, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const PW = 'correct-horse-battery-staple-9';
const status = (over: Partial<Status> = {}) => ({ publicUrl: null, ...over }) as Status;

test('GET /status merges ngrok status with authRequired', async () => {
  const srv = await serve({ getStatus: () => status({ publicUrl: 'https://x.ngrok.app' }) });
  try {
    const res = await srv.call('GET', '/status');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { publicUrl: 'https://x.ngrok.app', authRequired: false });
  } finally { await srv.close(); }
});

test('POST /start 400s when ngrok is not installed', async () => {
  const srv = await serve({ installed: false });
  try {
    const res = await srv.call('POST', '/start', { password: PW });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /not installed/);
  } finally { await srv.close(); }
});

test('POST /start requires a string password', async () => {
  const srv = await serve({ installed: true });
  try {
    assert.equal((await srv.call('POST', '/start', {})).status, 400);
    assert.equal((await srv.call('POST', '/start', { password: 12345678901234 })).status, 400);
  } finally { await srv.close(); }
});

test('POST /start rejects a weak password without touching auth or spawning ngrok', async () => {
  let started = false;
  const srv = await serve({ installed: true, start: async () => { started = true; return 'u'; } });
  try {
    const res = await srv.call('POST', '/start', { password: 'short' });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /at least 12/);
    assert.equal(started, false);
    assert.equal(srv.auth.enabled, false);
  } finally { await srv.close(); }
});

test('POST /start forwards a numeric body port to ngrok', async () => {
  let port: number | undefined;
  const srv = await serve({ installed: true, start: async (p: number) => { port = p; return 'https://x.ngrok.app'; } });
  try {
    const res = await srv.call('POST', '/start', { password: PW, port: 4321 });
    assert.equal(res.status, 200);
    assert.equal(port, 4321);
    assert.equal(((await res.json()) as { publicUrl: string }).publicUrl, 'https://x.ngrok.app');
  } finally { await srv.close(); }
});

test('a failed start keeps a pre-existing password', async () => {
  const auth = new AuthService();
  auth.setPassword('previously-set-password-1');
  const srv = await serve({ installed: true, start: async () => { throw new Error('boom'); }, getStatus: () => status() }, auth);
  try {
    const res = await srv.call('POST', '/start', { password: PW });
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as { error: string }).error, 'boom');
    assert.equal(auth.enabled, true);
  } finally { await srv.close(); }
});

test('POST /stop returns 204, or 500 with the error message', async () => {
  let fail = false;
  const srv = await serve({ stop: async () => { if (fail) throw new Error('stuck'); } });
  try {
    assert.equal((await srv.call('POST', '/stop')).status, 204);
    fail = true;
    const res = await srv.call('POST', '/stop');
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as { error: string }).error, 'stuck');
  } finally { await srv.close(); }
});

test('POST /recheck re-detects the install then reports status', async () => {
  let rechecked = false;
  const srv = await serve({
    recheckInstallation: async () => { rechecked = true; },
    getStatus: () => status({ installed: rechecked } as Partial<Status>),
  });
  try {
    const res = await srv.call('POST', '/recheck');
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { installed: boolean }).installed, true);
  } finally { await srv.close(); }
});
