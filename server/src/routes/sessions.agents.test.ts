import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { AgentChatResponse, ChatMessage } from '@argus/shared';
import type { SessionManager } from '../services/SessionManager.js';
import type { OrderStore } from '../persistence/OrderStore.js';
import type { GroupStore } from '../persistence/GroupStore.js';
import type { ConfigStore } from '../persistence/ConfigStore.js';
import { createSessionRoutes } from './sessions.js';
import { errorHandler } from '../middleware/errorHandler.js';

// GET /:id/agents/:agentId/chat reads one agent's own transcript for the agent
// sheet. The agent id becomes part of a file name, so anything that could leave
// the subagents folder is a 400 before the manager sees it.

const AGENT = 'aaaaaaaaaaaaaaaaa';
const END = 42;
const MESSAGE = { id: 'm1', role: 'assistant', blocks: [{ kind: 'text', text: 'hi' }] } as unknown as ChatMessage;

let server: Server;
let base: string;
const calls: Array<[string, string, number]> = [];

before(async () => {
  const store = { load: async () => [], save: async () => {} } as unknown as OrderStore;
  const groupStore = { load: async () => [], save: async () => {} } as unknown as GroupStore;
  const configStore = { load: async () => ({}), save: async () => {} } as unknown as ConfigStore;
  const manager = {
    agentChat: async (id: string, agentId: string, after: number): Promise<AgentChatResponse | undefined> => {
      calls.push([id, agentId, after]);
      if (id !== 's1' || agentId !== AGENT) return undefined;
      return { available: true, messages: after < END ? [MESSAGE] : [], offset: END };
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

const chat = (id: string, agentId: string, after: string) =>
  fetch(`${base}/${id}/agents/${encodeURIComponent(agentId)}/chat?after=${encodeURIComponent(after)}`);

test('agents chat: 200 with messages and the new offset', async () => {
  const first = await chat('s1', AGENT, '0');
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { available: true, messages: [MESSAGE], offset: END });

  const next = await chat('s1', AGENT, String(END));
  assert.equal(next.status, 200);
  assert.deepEqual(await next.json(), { available: true, messages: [], offset: END });
  assert.deepEqual(calls.at(-1), ['s1', AGENT, END]);
});

test('agents chat: 400 for an agent id with a slash, a dot, or over 64 chars; 400 for a non-integer after', async () => {
  const before = calls.length;
  for (const bad of ['a/b', 'a.b', 'x'.repeat(65)]) {
    assert.equal((await chat('s1', bad, '0')).status, 400, `agent id ${bad}`);
  }
  for (const bad of ['1.5', '-1', 'abc', '']) {
    assert.equal((await chat('s1', AGENT, bad)).status, 400, `after ${JSON.stringify(bad)}`);
  }
  assert.equal(calls.length, before, 'the manager is never asked');
});

test('agents chat: 404 for an unknown session or agent', async () => {
  assert.equal((await chat('nope', AGENT, '0')).status, 404);
  assert.equal((await chat('s1', 'bbbbbbbbbbbbbbbb', '0')).status, 404);
});
