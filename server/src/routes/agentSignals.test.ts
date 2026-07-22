import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createAgentSignalRoutes } from './agentSignals.js';
import { computeSignalToken } from '../services/agentSignals/token.js';
import type { SessionManager } from '../services/SessionManager.js';

const SECRET = 'test-secret-abc';
const calls: Array<{ id: string; sig: any }> = [];

const fakeManager = {
  applyNativeSignal: (id: string, sig: any) => {
    calls.push({ id, sig });
  },
} as unknown as SessionManager;

let server: Server;
let base: string;

before(async () => {
  const app = express();
  app.use('/api/agent-signals', createAgentSignalRoutes(fakeManager, () => SECRET));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api/agent-signals`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(sessionId: string, body: unknown): Promise<Response> {
  return fetch(`${base}/${sessionId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('valid token + state → 204 and forwards to applyNativeSignal', async () => {
  calls.length = 0;
  const token = computeSignalToken(SECRET, 'sess-1');
  const res = await post('sess-1', { token, state: 'waiting', promptText: 'Proceed?', coverage: ['running', 'waiting', 'idle'] });
  assert.equal(res.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.id, 'sess-1');
  assert.equal(calls[0]!.sig.state, 'waiting');
  assert.equal(calls[0]!.sig.promptText, 'Proceed?');
  assert.deepEqual(calls[0]!.sig.coverage, ['running', 'waiting', 'idle']);
});

test('bad token → 401 and does not forward', async () => {
  calls.length = 0;
  const res = await post('sess-1', { token: 'wrong', state: 'idle' });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('token bound to another session is rejected (401)', async () => {
  calls.length = 0;
  const token = computeSignalToken(SECRET, 'sess-OTHER');
  const res = await post('sess-1', { token, state: 'idle' });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('invalid / missing state → 400', async () => {
  const token = computeSignalToken(SECRET, 'sess-1');
  assert.equal((await post('sess-1', { token, state: 'bogus' })).status, 400);
  assert.equal((await post('sess-1', { token })).status, 400);
});

test('invalid coverage entries are filtered out', async () => {
  calls.length = 0;
  const token = computeSignalToken(SECRET, 'sess-1');
  const res = await post('sess-1', { token, state: 'idle', coverage: ['idle', 'garbage', 'running'] });
  assert.equal(res.status, 204);
  assert.deepEqual(calls[0]!.sig.coverage, ['idle', 'running'], 'unknown coverage states dropped');
});

test('oversized body is rejected by the 16kb cap', async () => {
  const token = computeSignalToken(SECRET, 'sess-1');
  const huge = 'x'.repeat(32 * 1024);
  const res = await post('sess-1', { token, state: 'idle', promptText: huge });
  assert.equal(res.status, 413, 'payload too large');
});
