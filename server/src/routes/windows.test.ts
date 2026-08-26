import { test, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { ArgusWindow, WindowRegistryState } from '@argus/shared';
import { MAIN_WINDOW_ID } from '../constants/windows.js';
import { WindowStore } from '../persistence/WindowStore.js';
import { WindowRegistry } from '../services/WindowRegistry.js';
import { createWindowRoutes, type WindowHostHooks } from './windows.js';

let dir: string;
let registry: WindowRegistry;
let server: Server;
let base: string;
let hookCalls: string[];
const sessionIds = ['s1', 's2'];

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'argus-winroutes-test-'));
  registry = new WindowRegistry(new WindowStore(join(dir, 'windows.json')));
  await registry.init();
  hookCalls = [];
  const hooks: WindowHostHooks = {
    onCreate: (id) => hookCalls.push(`create:${id}`),
    onClose: (id) => hookCalls.push(`close:${id}`),
    onFocus: (id) => hookCalls.push(`focus:${id}`),
  };
  const app = express();
  app.use(express.json());
  app.use('/windows', createWindowRoutes(registry, () => sessionIds, hooks));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/windows`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  // Reset: merge everything into main (removes secondaries) and clear hook log.
  await registry.mergeAll(MAIN_WINDOW_ID, sessionIds);
  hookCalls = [];
});

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as never };
}

test('GET / returns the registry state', async () => {
  const { status, body } = await req('GET', '');
  assert.equal(status, 200);
  const state = body as WindowRegistryState;
  assert.equal(state.windows[0].id, MAIN_WINDOW_ID);
});

test('POST / creates a window (optionally claiming a session) and fires onCreate', async () => {
  const { status, body } = await req('POST', '', { sessionId: 's1' });
  assert.equal(status, 201);
  const win = body as ArgusWindow;
  assert.equal(registry.ownerOf('s1'), win.id);
  assert.deepEqual(hookCalls, [`create:${win.id}`]);
});

test('POST / with an unknown session is a 404', async () => {
  const { status } = await req('POST', '', { sessionId: 'ghost' });
  assert.equal(status, 404);
});

test('DELETE /:id merges sessions back and fires onClose; main is 400', async () => {
  const w = await registry.createWindow('s1');
  hookCalls = [];
  const { status } = await req('DELETE', `/${w.id}`);
  assert.equal(status, 200);
  assert.equal(registry.ownerOf('s1'), MAIN_WINDOW_ID);
  assert.deepEqual(hookCalls, [`close:${w.id}`]);
  assert.equal((await req('DELETE', `/${MAIN_WINDOW_ID}`)).status, 400);
  assert.equal((await req('DELETE', '/nope')).status, 404);
});

test('PUT /assign moves a session; unknown session or window is 404', async () => {
  const w = await registry.createWindow();
  const { status } = await req('PUT', '/assign', { sessionId: 's2', windowId: w.id });
  assert.equal(status, 200);
  assert.equal(registry.ownerOf('s2'), w.id);
  assert.equal((await req('PUT', '/assign', { sessionId: 'ghost', windowId: w.id })).status, 404);
  assert.equal((await req('PUT', '/assign', { sessionId: 's1', windowId: 'nope' })).status, 404);
});

test('POST /:id/merge-all gathers all sessions and fires onClose per removed window', async () => {
  const w2 = await registry.createWindow('s1');
  const w3 = await registry.createWindow('s2');
  hookCalls = [];
  const { status } = await req('POST', `/${w2.id}/merge-all`);
  assert.equal(status, 200);
  assert.equal(registry.ownerOf('s2'), w2.id);
  assert.deepEqual(hookCalls, [`close:${w3.id}`]);
  assert.equal((await req('POST', '/nope/merge-all')).status, 404);
});

test('POST /:id/focus fires onFocus without changing state', async () => {
  const { status } = await req('POST', `/${MAIN_WINDOW_ID}/focus`);
  assert.equal(status, 200);
  assert.deepEqual(hookCalls, [`focus:${MAIN_WINDOW_ID}`]);
  assert.equal((await req('POST', '/nope/focus')).status, 404);
});

test('PUT /:id/label renames a window (label is trimmed)', async () => {
  const w = await registry.createWindow();
  const { status } = await req('PUT', `/${w.id}/label`, { label: '  Reviews  ' });
  assert.equal(status, 200);
  const state = registry.getState();
  assert.equal(state.windows.find((x) => x.id === w.id)?.label, 'Reviews');
});

test('PUT /:id/label rejects invalid labels and unknown windows', async () => {
  assert.equal((await req('PUT', `/${MAIN_WINDOW_ID}/label`, { label: '' })).status, 400);
  assert.equal((await req('PUT', `/${MAIN_WINDOW_ID}/label`, { label: '   ' })).status, 400);
  assert.equal((await req('PUT', `/${MAIN_WINDOW_ID}/label`, { label: 'x'.repeat(61) })).status, 400);
  assert.equal((await req('PUT', `/${MAIN_WINDOW_ID}/label`, {})).status, 400);
  assert.equal((await req('PUT', '/nope/label', { label: 'X' })).status, 404);
});
