import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

// Beta F8 stale marker: computed inside the existing git poll, only while the
// flag is on, and cheaply (one `git log` per worktree per recheck window).

const DAY = 24 * 60 * 60 * 1000;

function fixture(lastCommit: number | null) {
  const configStore = { load: async () => ({}), save: async () => {} } as any;
  const sm = new SessionManager(os.tmpdir(), configStore);
  const emitted: Array<{ event: string; payload: any }> = [];
  (sm as any).io = {
    to: () => ({ emit: () => {} }),
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  };
  const folder = path.resolve(os.tmpdir());
  (sm as any).sessions.set('w', {
    id: 'w', name: 'w', folderPath: folder, worktreePath: folder, worktreeBranch: 'feat/old',
    agentType: 'claude', flags: [], status: 'idle', createdAt: new Date().toISOString(),
  });
  (sm as any).sessions.set('p', {
    id: 'p', name: 'p', folderPath: folder, agentType: 'claude', flags: [], status: 'idle', createdAt: new Date().toISOString(),
  });
  let logCalls = 0;
  let commitAt = lastCommit;
  // Set gitService directly: setGitService would also arm the poll interval.
  (sm as any).gitService = {
    isGitRepo: async () => true,
    hasChanges: async () => false,
    lastCommitTime: async () => { logCalls++; return commitAt; },
  };
  const poll = () => (sm as any).pollGitStatus() as Promise<void>;
  const stale = () => emitted.filter((e) => e.event === 'session:worktreeStale').map((e) => e.payload);
  return { sm, poll, stale, logCalls: () => logCalls, setCommit: (v: number | null) => { commitAt = v; } };
}

test('flag off: no last-commit lookups and no marker', async () => {
  const f = fixture(Date.now() - 30 * DAY);
  await f.poll();
  assert.equal(f.logCalls(), 0);
  assert.deepEqual(f.stale(), []);
  assert.equal(f.sm.getSessionInfo('w')?.worktreeStaleDays, undefined);
});

test('flag on: a worktree 30 days past its last commit is marked stale once', async () => {
  const f = fixture(Date.now() - 30 * DAY);
  f.sm.setWorktreeLifecycleEnabled(true);
  await f.poll();
  await f.poll();
  assert.deepEqual(f.stale(), [{ sessionId: 'w', staleDays: 30 }]);
  assert.equal(f.sm.getSessionInfo('w')?.worktreeStaleDays, 30);
  // Only the worktree session is checked, and the second tick reuses the cache.
  assert.equal(f.logCalls(), 1);
  assert.equal(f.sm.getSessionInfo('p')?.worktreeStaleDays, undefined);
});

test('a fresh worktree is not marked', async () => {
  const f = fixture(Date.now() - 2 * DAY);
  f.sm.setWorktreeLifecycleEnabled(true);
  await f.poll();
  assert.deepEqual(f.stale(), []);
});

test('switching the flag off clears every marker', async () => {
  const f = fixture(Date.now() - 20 * DAY);
  f.sm.setWorktreeLifecycleEnabled(true);
  await f.poll();
  f.sm.setWorktreeLifecycleEnabled(false);
  assert.deepEqual(f.stale(), [{ sessionId: 'w', staleDays: 20 }, { sessionId: 'w', staleDays: null }]);
  assert.equal(f.sm.getSessionInfo('w')?.worktreeStaleDays, undefined);
  await f.poll();
  assert.equal(f.logCalls(), 1, 'no lookups once off');
});
