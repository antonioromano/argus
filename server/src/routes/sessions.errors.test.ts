import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { SessionManager } from '../services/SessionManager.js';
import type { OrderStore } from '../persistence/OrderStore.js';
import type { GroupStore } from '../persistence/GroupStore.js';
import type { ConfigStore } from '../persistence/ConfigStore.js';
import { createSessionRoutes } from './sessions.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { ArgusError } from '../errors/ArgusError.js';

// POST /sessions failures carry a typed code when the user can act on them
// (plan 2026-10-29-003, Unit 2); validation stays a code-less 400.

async function create(failure: unknown, body: Record<string, unknown> = { folderPath: '/tmp/x' }) {
  const store = { load: async () => [], save: async () => {} } as unknown as OrderStore;
  const manager = { createSession: async () => { throw failure; } } as unknown as SessionManager;
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', createSessionRoutes(manager, store, store, store as unknown as GroupStore, { load: async () => ({}) } as unknown as ConfigStore));
  app.use(errorHandler);
  const server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as { error?: string; code?: string } };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test('an unknown agent type answers 400 AGENT_UNKNOWN', async () => {
  const { status, body } = await create(new ArgusError('AGENT_UNKNOWN', 400, 'Unknown agent type: "nope"'), { folderPath: '/tmp/x', agentType: 'nope' });
  assert.equal(status, 400);
  assert.equal(body.code, 'AGENT_UNKNOWN');
  assert.match(body.error ?? '', /Unknown agent type/);
});

test('a missing folder answers 404 FOLDER_NOT_FOUND', async () => {
  const { status, body } = await create(new ArgusError('FOLDER_NOT_FOUND', 404, 'Folder does not exist: /tmp/x'));
  assert.equal(status, 404);
  assert.equal(body.code, 'FOLDER_NOT_FOUND');
});

test('argusd not coming up answers 503 DAEMON_UNAVAILABLE', async () => {
  const { status, body } = await create(new ArgusError('DAEMON_UNAVAILABLE', 503, 'argusd did not come up in time'));
  assert.equal(status, 503);
  assert.equal(body.code, 'DAEMON_UNAVAILABLE');
});

test('a plain validation failure stays a 400 without a code', async () => {
  const { status, body } = await create(new Error('Invalid worktree branch name'));
  assert.equal(status, 400);
  assert.deepEqual(body, { error: 'Invalid worktree branch name' });
});

test('git missing while creating a worktree answers 503 GIT_NOT_INSTALLED', async () => {
  const { status, body } = await create(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT', syscall: 'spawn git', path: 'git' }));
  assert.equal(status, 503);
  assert.equal(body.code, 'GIT_NOT_INSTALLED');
});
