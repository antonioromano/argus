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
import type { SessionIdentityPatch } from '../constants/sessionIdentity.js';
import { createSessionRoutes } from './sessions.js';
import { errorHandler } from '../middleware/errorHandler.js';

// PATCH /:id/identity validates before the manager sees anything: only a
// palette key and one emoji grapheme are ever stored.

let server: Server;
let base: string;
const calls: Array<[string, SessionIdentityPatch]> = [];

before(async () => {
  const store = { load: async () => [], save: async () => {} } as unknown as OrderStore;
  const groupStore = { load: async () => [], save: async () => {} } as unknown as GroupStore;
  const configStore = { load: async () => ({}), save: async () => {} } as unknown as ConfigStore;

  const manager = {
    setSessionIdentity: async (id: string, patch: SessionIdentityPatch): Promise<SessionInfo> => {
      calls.push([id, patch]);
      if (id !== 'live') throw new Error(`Session ${id} not found`);
      return { id, name: 'api', folderPath: '/tmp/x', status: 'idle', createdAt: 'now', agentType: 'claude', flags: [], color: patch.color ?? undefined, emoji: patch.emoji ?? undefined } as SessionInfo;
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

function patch(id: string, body: unknown) {
  return fetch(`${base}/${id}/identity`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('sets a valid identity and echoes the session', async () => {
  const res = await patch('live', { color: 'teal', emoji: '🦊' });
  assert.equal(res.status, 200);
  const body = await res.json() as SessionInfo;
  assert.equal(body.color, 'teal');
  assert.deepEqual(calls.at(-1), ['live', { color: 'teal', emoji: '🦊' }]);
});

test('an invalid colour or emoji is a 400 and never reaches the manager', async () => {
  const before = calls.length;
  assert.equal((await patch('live', { color: '#fff' })).status, 400);
  assert.equal((await patch('live', { emoji: '🦊🦊' })).status, 400);
  assert.equal((await patch('live', {})).status, 400);
  assert.equal(calls.length, before);
});

test('an unknown session is a 404', async () => {
  const res = await patch('ghost', { color: null });
  assert.equal(res.status, 404);
});
