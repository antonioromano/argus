import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { errorHandler } from './errorHandler.js';

async function request(status: number): Promise<{ status: number; body: unknown }> {
  const app = express();
  app.get('/boom', (_req, _res, next) => next(Object.assign(new Error('x'), { status })));
  app.use(errorHandler);
  const server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/boom`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test('middleware 404 (e.g. express.static missing file) says Not found', async () => {
  assert.deepEqual(await request(404), { status: 404, body: { error: 'Not found' } });
});

test('middleware 413 keeps its own copy', async () => {
  assert.deepEqual(await request(413), { status: 413, body: { error: 'Request body too large' } });
});

test('other 4xx stay Bad request', async () => {
  assert.deepEqual(await request(400), { status: 400, body: { error: 'Bad request' } });
});
