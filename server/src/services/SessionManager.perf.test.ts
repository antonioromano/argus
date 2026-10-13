import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { mkdtempSync } from 'fs';
import path from 'path';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

const cfg = { load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }), save: async () => {} } as any;

function harness() {
  const sm = new SessionManager(os.tmpdir(), cfg);
  const pty = () => ({
    pid: 1, cols: 120, rows: 30, process: 'x', handleFlowControl: false,
    onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
    write() {}, resize() {}, clear() {}, kill() {}, pause() {}, resume() {},
  });
  const b = {
    kind: 'daemon', isPersistent: () => true,
    spawn: () => pty(),
    seedMirror() {}, writeWheel() {}, detach() {}, stopSession() {}, stopAll() {},
    listSurvivors: async () => new Set<string>(), isSurvivorDead: () => true, reapOrphans: async () => {},
  };
  (sm as any).backend = b;
  (sm as any).directBackend = b;
  (sm as any).fileWatcher = { watch() {}, stop: async () => {}, stopAll: async () => {} };
  return sm;
}

test('restoreSessions writes sessions.json once, not once per restored session', async () => {
  const sm = harness();
  const saves: unknown[][] = [];
  const persisted = Array.from({ length: 5 }, (_, i) => ({
    id: `r${i}`, name: `r${i}`, folderPath: os.tmpdir(), createdAt: new Date().toISOString(),
    agentType: 'claude', flags: [], runMode: 'persistent',
  }));
  (sm as any).store = { load: async () => persisted, save: async (d: unknown[]) => { saves.push(d); } };

  await sm.restoreSessions();

  assert.equal(sm.getAllSessions().length, 5);
  assert.equal(saves.length, 1, `expected one write, got ${saves.length}`);
  assert.equal(saves[0]!.length, 5, 'the single write carries every restored session');
  await sm.shutdown();
});

test('a plain createSession still persists immediately', async () => {
  const sm = harness();
  const saves: unknown[][] = [];
  (sm as any).store = { load: async () => [], save: async (d: unknown[]) => { saves.push(d); } };
  await sm.createSession(os.tmpdir(), 'n', 'claude', []);
  assert.equal(saves.length, 1);
  await sm.shutdown();
});

test('git poll runs one status per folder per tick, at most 4 at a time', async () => {
  const sm = harness();
  (sm as any).store = { load: async () => [], save: async () => {} };
  const base = mkdtempSync(path.join(os.tmpdir(), 'argus-poll-'));
  const folders = Array.from({ length: 8 }, (_, i) => path.join(base, `f${i}`));
  const sessions = new Map<string, any>();
  // 8 distinct folders + 3 extra sessions sharing f0.
  [...folders, folders[0], folders[0], folders[0]].forEach((folderPath, i) => {
    sessions.set(`s${i}`, { id: `s${i}`, folderPath, status: 'idle' });
  });
  (sm as any).sessions = sessions;

  const calls = new Map<string, number>();
  let inFlight = 0;
  let peak = 0;
  const emits: any[] = [];
  (sm as any).io = { emit: (_e: string, p: any) => emits.push(p), to: () => ({ emit() {} }) };
  sm.setGitService({
    isGitRepo: async () => true,
    hasChanges: async (folder: string) => {
      calls.set(folder, (calls.get(folder) ?? 0) + 1);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return folder === folders[0];
    },
  } as any);
  clearInterval((sm as any).gitPollTimer);

  await (sm as any).pollGitStatus();

  assert.equal(calls.size, 8);
  for (const [f, n] of calls) assert.equal(n, 1, `${f} polled ${n} times`);
  assert.ok(peak <= 4, `peak concurrency ${peak}`);
  assert.ok(peak > 1, 'polls should overlap, not run strictly serially');
  // Every session sharing f0 still gets its own dirty broadcast.
  const dirty = emits.filter((e) => e.hasGitChanges).map((e) => e.sessionId).sort();
  assert.deepEqual(dirty, ['s0', 's10', 's8', 's9']);
});
