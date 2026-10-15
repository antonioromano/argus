import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { AgentDefinition, AppConfig, SessionInfo } from '@argus/shared';
import { createHandoffRoutes, type HandoffDeps } from './handoff.js';
import type { GitContext } from '../services/handoff.js';

// Beta F12 handoff route: gating, validation, preview, delivery. Git and the
// transcript reader are fakes; the brief is written to a temp dir.

const AGENTS: AgentDefinition[] = [
  { id: 'claude', name: 'Claude', command: 'claude', builtin: true },
  { id: 'codex', name: 'Codex', command: 'codex', builtin: true },
  { id: 'shell', name: 'Shell', command: '/bin/zsh', builtin: true },
  { id: 'aider', name: 'Aider', command: 'aider', builtin: false },
];
const GIT: GitContext = { isGitRepo: true, branch: 'main', status: '', statusTruncated: false, diffStat: '', diff: '', diffTruncated: false };

interface Opts { enabled?: boolean; source?: Partial<SessionInfo>; outside?: boolean; createFails?: boolean }

async function serve(o: Opts = {}) {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'argus-handoff-src-'));
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'argus-handoff-data-'));
  const source: SessionInfo = { id: 's1', name: 'api', folderPath: folder, status: 'idle', createdAt: '', agentType: 'claude', flags: [], ...o.source };
  const created: Array<{ folder: string; name: string; agent: string; flags: string[]; prompt?: string }> = [];
  const typed: Array<[string, string]> = [];
  const gitCalls: Array<[string, boolean]> = [];
  const readCalls: Array<[readonly string[], number]> = [];
  const deps: HandoffDeps = {
    isEnabled: () => o.enabled ?? true,
    handoffDir: path.join(dataDir, 'handoffs'),
    loadConfig: async () => ({ customAgents: [AGENTS[3]], agentFlags: { codex: [{ label: 'x', value: '--full-auto', enabled: true }] } } as unknown as AppConfig),
    agentRegistry: { getById: (id) => AGENTS.find((a) => a.id === id) },
    manager: {
      getSessionInfo: (id) => (id === source.id ? source : undefined),
      resolveWithinAnySession: (p) => (o.outside ? null : p),
      handoffTranscripts: () => ['/t/a.jsonl'],
    },
    createSession: async (f, name, agent, flags, prompt) => {
      if (o.createFails) throw new Error('spawn failed');
      created.push({ folder: f, name, agent, flags, prompt });
      return { ...source, id: 'new1', name, folderPath: f, agentType: agent };
    },
    typePrompt: (id, text) => typed.push([id, text]),
    gitContext: async (f, d) => { gitCalls.push([f, d]); return GIT; },
    readMessages: async (paths, n) => { readCalls.push([paths, n]); return [{ role: 'user', text: 'hello' }]; },
    newId: () => 'hid',
    now: () => new Date('2026-10-15T00:00:00Z'),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', createHandoffRoutes(deps));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as AddressInfo;
  const post = async (body: unknown, id = 's1') => {
    const res = await fetch(`http://127.0.0.1:${port}/api/sessions/${id}/handoff`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(folder, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { post, close, created, typed, gitCalls, readCalls, folder, dataDir };
}

test('404 while the beta flag is off, and for an unknown session', async () => {
  const s = await serve({ enabled: false });
  try {
    assert.equal((await s.post({})).status, 404);
    assert.equal(s.created.length, 0);
  } finally { await s.close(); }
  const t = await serve();
  try {
    assert.equal((await t.post({}, 'nope')).status, 404);
  } finally { await t.close(); }
});

test('rejects bad input', async () => {
  const s = await serve();
  try {
    for (const body of [
      { messageCount: 51 }, { messageCount: -1 }, { messageCount: 1.5 }, { includeDiff: 'yes' },
      { note: 5 }, { note: 'x'.repeat(4001) }, { folderPath: 'relative/dir' }, { agentType: 'rm -rf' },
      { agentType: 'shell' }, { folderPath: '/definitely/not/here' },
    ]) {
      const r = await s.post(body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(s.created.length, 0);
  } finally { await s.close(); }
});

test('400 when the source folder is outside every managed session', async () => {
  const s = await serve({ outside: true });
  try {
    assert.equal((await s.post({})).status, 400);
    assert.equal(s.gitCalls.length, 0);
  } finally { await s.close(); }
});

test('preview reports the size and creates nothing', async () => {
  const s = await serve();
  try {
    const r = await s.post({ preview: true, messageCount: 4, includeDiff: false });
    assert.equal(r.status, 200);
    assert.equal(r.body.preview, true);
    assert.equal(r.body.messages, 1);
    assert.ok((r.body.bytes as number) > 100);
    assert.deepEqual(s.readCalls, [[['/t/a.jsonl'], 4]]);
    assert.equal(s.gitCalls[0]![1], false);
    assert.equal(s.created.length, 0);
  } finally { await s.close(); }
});

test('creates the new shell with the brief as its first prompt (same agent by default)', async () => {
  const s = await serve();
  try {
    const r = await s.post({ note: 'carry on' });
    assert.equal(r.status, 201);
    const briefPath = path.join(s.dataDir, 'handoffs', 'hid.md');
    assert.equal(r.body.briefPath, briefPath);
    assert.match(readFileSync(briefPath, 'utf8'), /carry on/);
    assert.equal(s.created.length, 1);
    assert.equal(s.created[0]!.agent, 'claude');
    assert.equal(s.created[0]!.name, 'api (handoff)');
    assert.equal(s.created[0]!.prompt, `Read the handoff brief at ${briefPath} and continue from it: carry on`);
    assert.equal(s.typed.length, 0);
  } finally { await s.close(); }
});

test('another agent: no transcript for a non-Claude source, sticky flags applied', async () => {
  const s = await serve({ source: { agentType: 'codex' } });
  try {
    const r = await s.post({ agentType: 'codex' });
    assert.equal(r.status, 201);
    assert.equal(s.readCalls.length, 0);
    assert.deepEqual(s.created[0]!.flags, ['--full-auto']);
  } finally { await s.close(); }
});

test('an agent without a prompt flag gets the prompt typed once ready', async () => {
  const s = await serve();
  try {
    const r = await s.post({ agentType: 'aider' });
    assert.equal(r.status, 201);
    assert.equal(s.created[0]!.prompt, undefined);
    assert.equal(s.typed.length, 1);
    assert.equal(s.typed[0]![0], 'new1');
    assert.match(s.typed[0]![1], /^Read the handoff brief at /);
  } finally { await s.close(); }
});

test('a failed spawn answers 400', async () => {
  const s = await serve({ createFails: true });
  try {
    const r = await s.post({});
    assert.equal(r.status, 400);
    assert.match(String(r.body.error), /spawn failed/);
  } finally { await s.close(); }
});
