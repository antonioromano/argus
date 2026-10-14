import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createAutoApprovalRoutes } from './autoApproval.js';
import { AutoApprovalStore } from '../persistence/AutoApprovalStore.js';
import { AutoApprovalService } from '../services/autoApproval/AutoApprovalService.js';

let root: string;
let folder: string;
let other: string;
let server: Server;
let base: string;
let store: AutoApprovalStore;
let service: AutoApprovalService;
const sessions = [{ id: 's1', folderPath: '', status: 'running', agentType: 'claude' }];

before(async () => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'argus-aaroute-')));
  folder = path.join(root, 'proj');
  other = path.join(root, 'other');
  mkdirSync(folder);
  mkdirSync(other);
  symlinkSync(folder, path.join(root, 'proj-link'));
  sessions[0]!.folderPath = folder;
  store = new AutoApprovalStore(path.join(root, 'data', 'auto-approval.json'));
  await store.load();
  service = new AutoApprovalService({
    store,
    isEnabled: () => true,
    getSession: (id) => sessions.find((s) => s.id === id),
  });
  const app = express();
  app.use(express.json());
  app.use('/api/auto-approval', createAutoApprovalRoutes({ store, service, listSessions: () => sessions }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auto-approval`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

const post = (body: unknown) => fetch(`${base}/rules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('add a rule for a session folder, list it, see its audit, delete it', async () => {
  const res = await post({ folder, tool: 'Bash', bashPrefix: 'npm test' });
  assert.equal(res.status, 201);
  const rule = await res.json();

  assert.ok(service.decide('s1', { hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'npm test' } }));

  const state = await (await fetch(`${base}/rules?folder=${encodeURIComponent(folder)}`)).json();
  assert.equal(state.folder, folder);
  assert.deepEqual(state.rules.map((r: { id: string }) => r.id), [rule.id]);
  assert.equal(state.audit.length, 1);
  assert.equal(state.audit[0].summary, 'npm test');

  const folders = await (await fetch(`${base}/folders`)).json();
  assert.deepEqual(folders.folders.find((f: { folder: string }) => f.folder === folder), { folder, ruleCount: 1, hasSession: true });

  assert.equal((await post({ folder, tool: 'Bash', bashPrefix: 'npm  test' })).status, 409, 'duplicate after normalization');

  const del = await fetch(`${base}/rules/${rule.id}?folder=${encodeURIComponent(folder)}`, { method: 'DELETE' });
  assert.equal(del.status, 204);
  assert.equal((await fetch(`${base}/rules/${rule.id}?folder=${encodeURIComponent(folder)}`, { method: 'DELETE' })).status, 404);
});

test('a symlinked folder path is stored under its realpath', async () => {
  const res = await post({ folder: path.join(root, 'proj-link'), tool: 'Read' });
  assert.equal(res.status, 201);
  assert.equal(store.rulesFor(folder).length, 1);
  await fetch(`${base}/rules/${(await res.json()).id}?folder=${encodeURIComponent(folder)}`, { method: 'DELETE' });
});

test('folders that are not session folders are rejected', async () => {
  for (const f of ['relative/path', '', other, path.join(folder, 'sub'), '/', `${folder}/..`, path.join(root, 'missing'), 42, null]) {
    assert.equal((await post({ folder: f, tool: 'Read' })).status, 400, `POST ${String(f)}`);
  }
  assert.equal((await fetch(`${base}/rules?folder=${encodeURIComponent(other)}`)).status, 400);
  assert.equal((await fetch(`${base}/rules`)).status, 400);
});

test('invalid rules are rejected with a reason', async () => {
  for (const body of [
    { folder, tool: 'Bash' },
    { folder, tool: 'Bash', bashPrefix: 'git status && rm' },
    { folder, tool: 'Edit', pathGlob: '../**' },
    { folder, tool: 'Edit', pathGlob: '/etc/passwd' },
    { folder, tool: 'WebFetch' },
  ]) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(typeof (await res.json()).error, 'string');
  }
});

test('rules of a folder whose sessions ended can still be read and removed, not added', async () => {
  const rule = await (await post({ folder, tool: 'Read' })).json();
  sessions.length = 0;
  try {
    assert.equal((await fetch(`${base}/rules?folder=${encodeURIComponent(folder)}`)).status, 200);
    assert.equal((await post({ folder, tool: 'Edit' })).status, 400);
    assert.equal((await fetch(`${base}/rules/${rule.id}?folder=${encodeURIComponent(folder)}`, { method: 'DELETE' })).status, 204);
  } finally {
    sessions.push({ id: 's1', folderPath: folder, status: 'running', agentType: 'claude' });
  }
});
