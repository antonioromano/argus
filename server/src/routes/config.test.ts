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

test('PUT debugToolsEnabled:true persists and is returned (allowlist regression)', async () => {
  // Regression: the PUT allowlist must include debugToolsEnabled, else the
  // Settings toggle can never turn on (the field is silently dropped on save).
  const { status, body } = await put({ debugToolsEnabled: true });
  assert.equal(status, 200);
  assert.equal(body.debugToolsEnabled, true);
  const loaded = await get();
  assert.equal(loaded.debugToolsEnabled, true);
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

// ─── Tile header: quick action / running indicator / first-run marker ────────
// Each field must be in the PUT allowlist AND validated, or Settings can never
// change it (silently dropped) or a bad value reaches the renderer.

test('defaults expose the tile header fields', async () => {
  const loaded = await get();
  assert.equal(loaded.tileQuickAction, 'diff');
  assert.equal(loaded.tileRunningIndicator, 'hairline');
  assert.equal(loaded.quickActionPromptedAt, '');
});

test('PUT tileQuickAction persists a valid action (allowlist regression)', async () => {
  const { status, body } = await put({ tileQuickAction: 'files' });
  assert.equal(status, 200);
  assert.equal(body.tileQuickAction, 'files');
  const loaded = await get();
  assert.equal(loaded.tileQuickAction, 'files');
});

test('PUT tileQuickAction:none is a real choice, not treated as unset', async () => {
  const { body } = await put({ tileQuickAction: 'none' });
  assert.equal(body.tileQuickAction, 'none');
});

test('an unknown tileQuickAction is rejected, keeping the stored value', async () => {
  await put({ tileQuickAction: 'diff' });
  const { body } = await put({ tileQuickAction: 'rm-rf' });
  assert.equal(body.tileQuickAction, 'diff');
});

test('a non-string tileQuickAction is rejected', async () => {
  await put({ tileQuickAction: 'diff' });
  const { body } = await put({ tileQuickAction: 42 });
  assert.equal(body.tileQuickAction, 'diff');
});

test('PUT tileRunningIndicator toggles between hairline and off', async () => {
  assert.equal((await put({ tileRunningIndicator: 'off' })).body.tileRunningIndicator, 'off');
  assert.equal((await put({ tileRunningIndicator: 'hairline' })).body.tileRunningIndicator, 'hairline');
});

test('an unknown tileRunningIndicator is rejected', async () => {
  await put({ tileRunningIndicator: 'hairline' });
  const { body } = await put({ tileRunningIndicator: 'strobe' });
  assert.equal(body.tileRunningIndicator, 'hairline');
});

test('quickActionPromptedAt stores the version that showed the picker', async () => {
  const { body } = await put({ quickActionPromptedAt: '0.22.0' });
  assert.equal(body.quickActionPromptedAt, '0.22.0');
  const loaded = await get();
  assert.equal(loaded.quickActionPromptedAt, '0.22.0');
});

test('quickActionPromptedAt can be cleared to re-arm the picker', async () => {
  await put({ quickActionPromptedAt: '0.22.0' });
  const { body } = await put({ quickActionPromptedAt: '' });
  assert.equal(body.quickActionPromptedAt, '');
});

test('a non-string quickActionPromptedAt is ignored, keeping the stamp', async () => {
  await put({ quickActionPromptedAt: '0.22.0' });
  const { body } = await put({ quickActionPromptedAt: true });
  assert.equal(body.quickActionPromptedAt, '0.22.0');
});
