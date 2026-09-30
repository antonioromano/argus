import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRegistry } from '../AgentRegistry.js';
import { LaunchService } from './LaunchService.js';

function setup(t: any, live: Record<string, string> = {}) {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-lsvc-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const folder = path.join(home, 'development', 'jarvar');
  mkdirSync(folder, { recursive: true });
  let saved: any[] = [];
  const config: any = { customAgents: [], launchFolderRoots: ['~/development'] };
  const svc = new LaunchService({
    store: { load: async () => saved, save: async (l) => { saved = l; } },
    loadConfig: async () => config,
    agentRegistry: new AgentRegistry(),
    home,
    findLiveByLauncher: (id) => (live[id] ? ({ id: live[id] } as any) : undefined),
    now: () => new Date('2026-09-30T10:00:00.000Z'),
  });
  return { svc, folder, config, get saved() { return saved; } };
}

test('add → list → resolveRun ready', async (t) => {
  const s = setup(t);
  const v = await s.svc.validate({ agent: 'claude', folder: s.folder, flags: [], prompt: 'refresh dashboard' });
  assert.ok(v.ok);
  assert.deepEqual(await s.svc.add({ id: 'jarvar-refresh', label: 'JarvAR refresh', validated: v.value }), { ok: true });
  assert.equal((await s.svc.list())[0].agentCommand, 'claude');
  const r = await s.svc.resolveRun('jarvar-refresh');
  assert.equal(r.kind, 'ready');
});

test('add rejects bad id, worktree launchers, and duplicates unless overwrite', async (t) => {
  const s = setup(t);
  const v = await s.svc.validate({ agent: 'claude', folder: s.folder, flags: [] });
  assert.ok(v.ok);
  assert.equal((await s.svc.add({ id: 'Bad Id', label: 'x', validated: v.value })).ok, false);
  const wt = { ...v.value, request: { ...v.value.request, worktree: 'feat/x' } };
  assert.equal((await s.svc.add({ id: 'wt', label: 'x', validated: wt })).ok, false);
  assert.equal((await s.svc.add({ id: 'a', label: 'x', validated: v.value })).ok, true);
  assert.equal((await s.svc.add({ id: 'a', label: 'y', validated: v.value })).ok, false);
  assert.equal((await s.svc.add({ id: 'a', label: 'y', validated: v.value, overwrite: true })).ok, true);
  assert.equal((await s.svc.list())[0].label, 'y');
});

test('resolveRun: unknown, live, changed agent command, changed folder config, invalid folder', async (t) => {
  const s = setup(t, { live1: 'sess-1' });
  assert.equal((await s.svc.resolveRun('nope')).kind, 'unknown');
  const v = await s.svc.validate({ agent: 'claude', folder: s.folder, flags: [] });
  assert.ok(v.ok);
  await s.svc.add({ id: 'live1', label: 'l', validated: v.value });
  assert.deepEqual(await s.svc.resolveRun('live1'), { kind: 'live', sessionId: 'sess-1' });

  await s.svc.add({ id: 'c1', label: 'c', validated: { ...v.value, agentCommand: 'claude-old' } });
  assert.equal((await s.svc.resolveRun('c1')).kind, 'changed');

  await s.svc.add({ id: 'c2', label: 'c', validated: v.value });
  mkdirSync(path.join(s.folder, '.claude'));
  const r = await s.svc.resolveRun('c2');
  assert.equal(r.kind, 'changed');
  assert.ok(r.kind === 'changed' && r.validated.warnings.some((w) => w.kind === 'launcher-changed'));

  rmSync(s.folder, { recursive: true, force: true });
  assert.equal((await s.svc.resolveRun('c2')).kind, 'invalid');
});

test('resolveRun: editing CLAUDE.md or .claude/settings.json content after save → changed', async (t) => {
  const s = setup(t);
  mkdirSync(path.join(s.folder, '.claude'));
  writeFileSync(path.join(s.folder, '.claude', 'settings.json'), '{}');
  writeFileSync(path.join(s.folder, 'CLAUDE.md'), '# v1');
  const v = await s.svc.validate({ agent: 'claude', folder: s.folder, flags: [] });
  assert.ok(v.ok);
  await s.svc.add({ id: 'h1', label: 'h', validated: v.value });
  assert.equal((await s.svc.resolveRun('h1')).kind, 'ready');

  writeFileSync(path.join(s.folder, 'CLAUDE.md'), '# v2');
  const r = await s.svc.resolveRun('h1');
  assert.equal(r.kind, 'changed');
  const w = r.kind === 'changed' ? r.validated.warnings.find((x) => x.kind === 'launcher-changed') : undefined;
  assert.ok(w && w.detail.includes('CLAUDE.md'), JSON.stringify(w));
  assert.ok(w && !/#[0-9a-f]{16}/.test(w.detail), 'reason lists relpaths, no hashes');

  await s.svc.add({ id: 'h2', label: 'h', validated: (await s.svc.validate({ agent: 'claude', folder: s.folder, flags: [] }) as any).value });
  writeFileSync(path.join(s.folder, '.claude', 'settings.json'), '{"hooks":{}}');
  assert.equal((await s.svc.resolveRun('h2')).kind, 'changed');
});

test('rename and remove', async (t) => {
  const s = setup(t);
  const v = await s.svc.validate({ agent: 'claude', folder: s.folder, flags: [] });
  assert.ok(v.ok);
  await s.svc.add({ id: 'a', label: 'x', validated: v.value });
  assert.deepEqual(await s.svc.rename('a', 'New name'), { ok: true });
  assert.equal((await s.svc.list())[0].label, 'New name');
  assert.equal((await s.svc.rename('a', '')).ok, false);
  assert.equal((await s.svc.rename('zz', 'x')).ok, false);
  assert.deepEqual(await s.svc.remove('a'), { ok: true });
  assert.deepEqual(await s.svc.list(), []);
});
