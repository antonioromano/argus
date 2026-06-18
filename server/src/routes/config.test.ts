import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { ConfigStore } from '../persistence/ConfigStore.js';
import { createConfigRoutes } from './config.js';

// Integration test for PUT/GET /api/config: spins a real express app over a
// ConfigStore backed by a temp file, exercising the merge/coerce/persist path.

let dir: string;
let store: ConfigStore;
let server: Server;
let base: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'argus-config-test-'));
  store = new ConfigStore(join(dir, 'config.json'));
  const app = express();
  app.use(express.json());
  app.use('/config', createConfigRoutes(store));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/config`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

async function put(body: unknown) {
  const res = await fetch(base, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get() {
  const res = await fetch(base);
  return res.json();
}

test('PUT exitSessionsOnQuit:true persists and is returned', async () => {
  const { status, body } = await put({ exitSessionsOnQuit: true });
  assert.equal(status, 200);
  assert.equal(body.exitSessionsOnQuit, true);
  const loaded = await get();
  assert.equal(loaded.exitSessionsOnQuit, true);
});

test('PUT confirmExitOnQuit:false persists', async () => {
  const { body } = await put({ confirmExitOnQuit: false });
  assert.equal(body.confirmExitOnQuit, false);
  const loaded = await get();
  assert.equal(loaded.confirmExitOnQuit, false);
});

test('omitting fields preserves existing values', async () => {
  await put({ exitSessionsOnQuit: true, confirmExitOnQuit: false });
  // A PUT touching only an unrelated field must not drop the quit settings.
  const { body } = await put({ showClock: true });
  assert.equal(body.exitSessionsOnQuit, true);
  assert.equal(body.confirmExitOnQuit, false);
  assert.equal(body.showClock, true);
});

test('truthy non-boolean is coerced to true', async () => {
  const { body } = await put({ exitSessionsOnQuit: 'yes' });
  assert.equal(body.exitSessionsOnQuit, true);
});

test('falsy value persists as false, not dropped', async () => {
  await put({ exitSessionsOnQuit: true });
  const { body } = await put({ exitSessionsOnQuit: 0 });
  assert.equal(body.exitSessionsOnQuit, false);
});
