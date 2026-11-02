import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';
import type { PersistedSession } from '../persistence/SessionStore.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

// The exit-127 "couldn't find <cmd>" card needs the exit code and how soon after
// spawn it came. Both are recorded on exit, persisted, and reported only while
// the session is exited.

function fixture() {
  const configStore = {
    load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
    save: async () => {},
  } as any;
  const sm = new SessionManager(os.tmpdir(), configStore);
  (sm as any).io = { to: () => ({ emit: () => {} }), emit: () => {} };
  const saves: PersistedSession[][] = [];
  (sm as any).store = { save: async (d: PersistedSession[]) => { saves.push(d); }, load: async () => [] };
  const session: any = {
    id: 'sess-1', name: 'api', folderPath: os.tmpdir(), agentType: 'claude', flags: [],
    status: 'exited', createdAt: new Date().toISOString(),
    pty: { resize: () => {} },
    stateDetector: { destroy: () => {} },
    spawnedAt: Date.now() - 300,
  };
  (sm as any).sessions.set('sess-1', session);
  return { sm, saves, session };
}

const flush = () => new Promise((r) => setImmediate(r));

test('records the exit code and time since spawn, and persists them', async () => {
  const f = fixture();
  (f.sm as any).recordExit(f.session, 127);
  await flush();

  const info = f.sm.getAllSessions().find((s) => s.id === 'sess-1')!;
  assert.equal(info.exitCode, 127);
  assert.ok(info.exitedAfterMs !== undefined && info.exitedAfterMs >= 300 && info.exitedAfterMs < 5_000);
  assert.equal(f.saves.at(-1)?.[0].lastExit?.exitCode, 127);
});

test('a session that is running again reports no exit code', () => {
  const f = fixture();
  f.session.lastExit = { exitCode: 127, exitedAfterMs: 40 };
  f.session.status = 'running';
  const info = f.sm.getAllSessions().find((s) => s.id === 'sess-1')!;
  assert.equal(info.exitCode, undefined);
  assert.equal(info.exitedAfterMs, undefined);
});
