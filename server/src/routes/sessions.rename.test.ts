import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionInfo } from '@argus/shared';
import type { SessionManager } from '../services/SessionManager.js';
import type { OrderStore } from '../persistence/OrderStore.js';
import type { GroupStore } from '../persistence/GroupStore.js';
import type { ConfigStore } from '../persistence/ConfigStore.js';
import { createSessionRoutes } from './sessions.js';
import { errorHandler } from '../middleware/errorHandler.js';

// PATCH /:id/name is the only write path for a shell's display name. It must
// reject blank names before reaching the manager, and turn an unknown id into a
// 404 rather than a 500.

let server: Server;
let base: string;
const renameCalls: Array<[string, string]> = [];

before(async () => {
  const store = { load: async () => [], save: async () => {} } as unknown as OrderStore;
  const groupStore = { load: async () => [], save: async () => {} } as unknown as GroupStore;
  const configStore = { load: async () => ({}), save: async () => {} } as unknown as ConfigStore;

  const manager = {
    renameSession: async (id: string, name: string): Promise<SessionInfo> => {
      renameCalls.push([id, name]);
      if (id !== 'live') throw new Error(`Session ${id} not found`);
      return { id, name, folderPath: '/tmp/x', status: 'idle', createdAt: 'now', agentType: 'claude', flags: [] } as SessionInfo;
    },
  } as unknown as SessionManager;

  const app = express();
  app.use(express.json());
  app.use('/api/sessions', createSessionRoutes(manager, store, store, groupStore, configStore));
  app.use(errorHandler);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function patchName(id: string, body: unknown) {
  return fetch(`${base}/${id}/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('renames a live session and echoes the updated SessionInfo', async () => {
  const res = await patchName('live', { name: 'billing spike' });
  assert.equal(res.status, 200);
  const body = await res.json() as SessionInfo;
  assert.equal(body.name, 'billing spike');
  assert.deepEqual(renameCalls.at(-1), ['live', 'billing spike']);
});

test('whitespace-only name is rejected before the manager is called', async () => {
  const before = renameCalls.length;
  const res = await patchName('live', { name: '   ' });
  assert.equal(res.status, 400);
  assert.equal(renameCalls.length, before, 'manager must not be called for a blank name');
});

test('missing name field is a 400', async () => {
  const res = await patchName('live', {});
  assert.equal(res.status, 400);
});

test('unknown session id is a 404, not a 500', async () => {
  const res = await patchName('ghost', { name: 'nope' });
  assert.equal(res.status, 404);
  const body = await res.json() as { error?: string };
  assert.match(body.error ?? '', /not found/);
});
