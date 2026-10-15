import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { AgentDefinition, AppConfig, SessionGroup, SessionInfo, SessionTemplate, TemplateSpec } from '@argus/shared';
import { createTemplateRoutes, type TemplateDeps } from './templates.js';

// Beta F10 template routes: gating, save-time validation, CRUD, and a
// best-effort launch into a new group. Stores are in memory; createSession is a fake.

const AGENTS: AgentDefinition[] = [
  { id: 'claude', name: 'Claude', command: 'claude', builtin: true },
  { id: 'codex', name: 'Codex', command: 'codex', builtin: true },
];

interface Opts { enabled?: boolean; failFor?: (spec: TemplateSpec) => boolean; groups?: SessionGroup[] }

async function serve(o: Opts = {}) {
  const folder = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-tpl-route-')));
  let enabled = o.enabled ?? true;
  let templates: SessionTemplate[] = [];
  let groups: SessionGroup[] = o.groups ?? [];
  const created: Array<{ spec: TemplateSpec; name: string; flags: string[] }> = [];
  const assigned: Array<[string, string]> = [];
  let groupsChanged = 0;
  let n = 0;
  const deps: TemplateDeps = {
    isEnabled: () => enabled,
    store: { load: async () => structuredClone(templates), save: async (l) => { templates = structuredClone(l); } },
    groupStore: { load: async () => structuredClone(groups), save: async (g) => { groups = structuredClone(g); } },
    loadConfig: async () => ({ customAgents: [], agentFlags: { claude: [{ label: 'x', value: '--verbose', enabled: true }] } } as unknown as AppConfig),
    agentRegistry: { getById: (id) => AGENTS.find((a) => a.id === id) },
    createSession: async (spec, name, flags) => {
      if (o.failFor?.(spec)) throw new Error(`git refused ${spec.worktreeBranch}`);
      created.push({ spec, name, flags });
      return { id: `s${created.length}`, name, folderPath: spec.folder, status: 'idle', createdAt: '', agentType: spec.agent, flags } as SessionInfo;
    },
    assignWindow: async (sid, wid) => { assigned.push([sid, wid]); return true; },
    onGroupsChanged: () => { groupsChanged++; },
    newId: () => `id${++n}`,
    now: () => new Date(2026, 9, 15, 10, 0, 0),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/templates', createTemplateRoutes(deps));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/templates${url}`, {
      method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
  };
  const close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(folder, { recursive: true, force: true });
  };
  return {
    call, close, folder, created, assigned,
    get templates() { return templates; }, set templates(t) { templates = t; },
    get groups() { return groups; },
    get groupsChanged() { return groupsChanged; },
    setEnabled: (v: boolean) => { enabled = v; },
  };
}

test('every route 404s while the flag is off', async () => {
  const s = await serve({ enabled: false });
  try {
    assert.equal((await s.call('GET', '/')).status, 404);
    assert.equal((await s.call('POST', '/', { name: 'x', specs: [{ agent: 'claude', folder: s.folder }] })).status, 404);
    assert.equal((await s.call('PUT', '/a', { name: 'x', specs: [] })).status, 404);
    assert.equal((await s.call('DELETE', '/a')).status, 404);
    assert.equal((await s.call('POST', '/a/launch', {})).status, 404);
    assert.equal(s.templates.length, 0);
    assert.equal(s.created.length, 0);
  } finally { await s.close(); }
});

test('save validates every spec and reports errors by index', async () => {
  const s = await serve();
  try {
    const bad = await s.call('POST', '/', { name: 'T', specs: [
      { agent: 'claude', folder: s.folder },
      { agent: 'bogus', folder: s.folder },
      { agent: 'claude', folder: 'relative' },
      { agent: 'claude', folder: s.folder, worktreeBranch: '-x' },
      { agent: 'claude', folder: s.folder, prompt: 'p'.repeat(4001) },
    ] });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.specErrors.map((e: { index: number }) => e.index), [4]);
    const bad2 = await s.call('POST', '/', { name: 'T', specs: [
      { agent: 'claude', folder: s.folder },
      { agent: 'bogus', folder: s.folder },
      { agent: 'claude', folder: 'relative' },
      { agent: 'claude', folder: s.folder, worktreeBranch: '-x' },
    ] });
    assert.equal(bad2.status, 400);
    assert.deepEqual(bad2.body.specErrors.map((e: { index: number }) => e.index), [1, 2, 3]);
    const tooMany = await s.call('POST', '/', { name: 'T', specs: Array(9).fill({ agent: 'claude', folder: s.folder }) });
    assert.equal(tooMany.status, 400);
    assert.equal(s.templates.length, 0);
  } finally { await s.close(); }
});

test('CRUD round-trip', async () => {
  const s = await serve();
  try {
    const c = await s.call('POST', '/', { name: 'Trio', specs: [{ agent: 'claude', folder: s.folder, name: 'api', prompt: 'hi' }] });
    assert.equal(c.status, 201);
    assert.equal(c.body.id, 'id1');
    assert.equal((await s.call('GET', '/')).body.templates.length, 1);
    const u = await s.call('PUT', '/id1', { name: 'Duo', specs: [{ agent: 'codex', folder: s.folder }] });
    assert.equal(u.status, 200);
    assert.equal(s.templates[0]!.name, 'Duo');
    assert.equal(s.templates[0]!.createdAt, c.body.createdAt);
    assert.equal((await s.call('PUT', '/nope', { name: 'x', specs: [{ agent: 'codex', folder: s.folder }] })).status, 404);
    assert.equal((await s.call('PUT', '/id1', { name: 'x', specs: [{ agent: 'bogus', folder: s.folder }] })).status, 400);
    assert.equal((await s.call('DELETE', '/id1')).status, 204);
    assert.equal((await s.call('DELETE', '/id1')).status, 404);
    assert.equal(s.templates.length, 0);
  } finally { await s.close(); }
});

test('launch: mixed success lands the started shells in a new group, no rollback', async () => {
  const s = await serve({ failFor: (spec) => spec.worktreeBranch === 'taken' });
  try {
    await s.call('POST', '/', { name: 'Trio', specs: [
      { agent: 'claude', folder: s.folder, name: 'api', prompt: 'build the API', worktreeBranch: 'feat/api' },
      { agent: 'codex', folder: s.folder, worktreeBranch: 'taken' },
      { agent: 'codex', folder: s.folder },
    ] });
    // A spec that went bad after it was saved is re-validated on launch.
    s.templates = s.templates.map((t) => ({ ...t, specs: [...t.specs, { agent: 'gone', folder: s.folder }] }));
    const r = await s.call('POST', '/id1/launch', { windowId: 'w2' });
    assert.equal(r.status, 201);
    const results = r.body.results as Array<{ index: number; ok: boolean; error?: string; session?: SessionInfo }>;
    assert.deepEqual(results.map((x) => x.ok), [true, false, true, false]);
    assert.match(results[1]!.error!, /git refused/);
    assert.match(results[3]!.error!, /Unknown agent/);
    assert.deepEqual(s.created.map((c) => c.name), ['api', path.basename(s.folder)]);
    assert.equal(s.created[0]!.spec.prompt, 'build the API');
    assert.equal(s.created[0]!.spec.worktreeBranch, 'feat/api');
    assert.deepEqual(s.created[0]!.flags, ['--verbose']);
    assert.deepEqual(s.assigned, [['s1', 'w2'], ['s2', 'w2']]);
    assert.equal(s.groups.length, 1);
    assert.deepEqual(r.body.group, s.groups[0]);
    assert.equal(s.groups[0]!.name, 'Trio');
    assert.deepEqual(s.groups[0]!.sessionIds, ['s1', 's2']);
    assert.equal(s.groupsChanged, 1);
  } finally { await s.close(); }
});

test('launch: a taken group name gets a timestamp; nothing started → no group', async () => {
  const existing: SessionGroup = { id: 'g0', name: 'Solo', color: 'blue', collapsed: false, sessionIds: [] };
  const s = await serve({ groups: [existing], failFor: (spec) => spec.agent === 'codex' });
  try {
    await s.call('POST', '/', { name: 'Solo', specs: [{ agent: 'claude', folder: s.folder }] });
    const r = await s.call('POST', '/id1/launch', {});
    assert.equal(r.body.group.name, 'Solo · 2026-10-15 10:00');
    assert.equal(s.groups.length, 2);
    assert.equal(s.assigned.length, 0);

    await s.call('POST', '/', { name: 'Broken', specs: [{ agent: 'codex', folder: s.folder }] });
    const id = s.templates[1]!.id;
    const none = await s.call('POST', `/${id}/launch`, {});
    assert.equal(none.status, 200);
    assert.equal(none.body.group, null);
    assert.equal(none.body.results[0].ok, false);
    assert.equal(s.groups.length, 2);
  } finally { await s.close(); }
});

test('launch: unknown template 404s; a bad windowId is refused', async () => {
  const s = await serve();
  try {
    assert.equal((await s.call('POST', '/nope/launch', {})).status, 404);
    await s.call('POST', '/', { name: 'T', specs: [{ agent: 'claude', folder: s.folder }] });
    assert.equal((await s.call('POST', '/id1/launch', { windowId: 5 })).status, 400);
    assert.equal(s.created.length, 0);
  } finally { await s.close(); }
});
