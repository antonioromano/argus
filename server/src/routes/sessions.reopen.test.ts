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

// POST /sessions with resumeClaudeSessionId reopens a closed Claude session
// (plan 004 U8). It validates the id and never rewrites sticky flag defaults.

const CONVO = '0f8fad5b-d9cb-469f-a165-70867728950e';

async function post(body: Record<string, unknown>) {
  const store = { load: async () => [], save: async () => {} } as unknown as OrderStore;
  const calls: unknown[][] = [];
  const manager = {
    createSession: async (...args: unknown[]) => {
      calls.push(args);
      return { id: 'new', agentType: 'claude', flags: args[3] ?? [] };
    },
  } as unknown as SessionManager;
  const saves: unknown[] = [];
  const configStore = {
    load: async () => ({ agentFlags: { claude: [{ value: '--model=opus', enabled: false }] } }),
    save: async (c: unknown) => { saves.push(c); },
  } as unknown as ConfigStore;
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', createSessionRoutes(manager, store, store, store as unknown as GroupStore, configStore));
  app.use(errorHandler);
  const server = await new Promise<Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as { error?: string }, calls, saves };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test('a reopen passes the conversation id through and leaves sticky defaults alone', async () => {
  const { status, calls, saves } = await post({ folderPath: '/tmp/x', agentType: 'claude', flags: ['--model=opus'], resumeClaudeSessionId: CONVO });
  assert.equal(status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 'claude');
  assert.deepEqual(calls[0][12], { resumeClaudeSessionId: CONVO });
  assert.equal(saves.length, 0, 'sticky flag defaults untouched');
});

test('a plain create still records sticky defaults and passes no resume', async () => {
  const { status, calls, saves } = await post({ folderPath: '/tmp/x', agentType: 'claude', flags: ['--model=opus'] });
  assert.equal(status, 201);
  assert.deepEqual(calls[0][12], {});
  assert.equal(saves.length, 1);
});

test('an invalid conversation id answers 400 without creating', async () => {
  const { status, body, calls } = await post({ folderPath: '/tmp/x', resumeClaudeSessionId: 'not-a-uuid --flag' });
  assert.equal(status, 400);
  assert.match(body.error ?? '', /conversation id/);
  assert.equal(calls.length, 0);
});

test('a worktree or non-Claude reopen answers 400', async () => {
  const wt = await post({ folderPath: '/tmp/x', worktreeBranch: 'feat', resumeClaudeSessionId: CONVO });
  assert.equal(wt.status, 400);
  const gem = await post({ folderPath: '/tmp/x', agentType: 'gemini', resumeClaudeSessionId: CONVO });
  assert.equal(gem.status, 400);
  assert.equal(wt.calls.length + gem.calls.length, 0);
});
