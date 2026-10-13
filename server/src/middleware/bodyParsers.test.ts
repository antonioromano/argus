import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createJsonBodyParser, parsesOwnBody } from './bodyParsers.js';
import { errorHandler } from './errorHandler.js';
import { createFilesystemRoutes } from '../routes/filesystem.js';
import { createAgentSignalRoutes } from '../routes/agentSignals.js';
import type { SessionManager } from '../services/SessionManager.js';

/** Mounted the way index.ts mounts it: app-wide parser, then the real routers. */
async function serve() {
  const app = express();
  app.set('case sensitive routing', true);
  app.use(createJsonBodyParser());
  const manager = { getSession: () => undefined } as unknown as SessionManager;
  app.use('/api/agent-signals', createAgentSignalRoutes(manager, () => 'secret'));
  app.use('/api/fs', createFilesystemRoutes(manager));
  app.post('/api/echo', (req, res) => { res.json({ got: typeof req.body?.blob === 'string' }); });
  app.use(errorHandler);
  const server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  const send = (method: string, path: string, bytes: number) => fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(path === '/api/echo' ? { blob: 'x'.repeat(bytes) } : { sessionId: 'nope', path: 'a.txt', content: 'x'.repeat(bytes) }),
  });
  return { send, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const MB = 1024 * 1024;

// S13: the app-wide 10 MB parser ran first, so the fs route's 2 MB limit (and
// the agent-signal route's 16 KB one) never applied.
test('PUT /api/fs/file enforces its own 2 MB limit', async () => {
  const { send, close } = await serve();
  try {
    assert.equal((await send('PUT', '/api/fs/file', 3 * MB)).status, 413);
    // Under the limit the body parses and the route runs (404: no such session).
    assert.equal((await send('PUT', '/api/fs/file', 1.5 * MB)).status, 404);
  } finally {
    await close();
  }
});

test('agent-signals enforces its own 16 KB limit', async () => {
  const { send, close } = await serve();
  try {
    assert.equal((await send('POST', '/api/agent-signals/s1', 64 * 1024)).status, 413);
  } finally {
    await close();
  }
});

test('every other route gets the 1 MB default', async () => {
  const { send, close } = await serve();
  try {
    assert.equal((await send('POST', '/api/echo', 2 * MB)).status, 413);
    const ok = await send('POST', '/api/echo', 512 * 1024);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { got: true });
  } finally {
    await close();
  }
});

test('parsesOwnBody matches exactly, method-aware', () => {
  assert.equal(parsesOwnBody({ method: 'PUT', path: '/api/fs/file' }), true);
  assert.equal(parsesOwnBody({ method: 'POST', path: '/api/fs/file' }), false);
  assert.equal(parsesOwnBody({ method: 'POST', path: '/api/agent-signals/abc' }), true);
  assert.equal(parsesOwnBody({ method: 'POST', path: '/api/agent-signalsX' }), false);
  assert.equal(parsesOwnBody({ method: 'POST', path: '/api/sessions' }), false);
});
