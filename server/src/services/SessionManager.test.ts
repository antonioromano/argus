import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

function withFakeExitedSession(sm: SessionManager, id: string) {
  (sm as any).sessions.set(id, {
    id,
    name: 'test',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    status: 'exited',
    createdAt: new Date().toISOString(),
    pty: {},
    stateDetector: { resize: () => {} },
    outputBuffer: '',
    persistent: false,
    hasUserInputSinceIdle: false,
  });
}

test('destroySession stops the folder watcher for that session', async () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  let stopped: string | null = null;
  (sm as any).fileWatcher = {
    watch: () => {},
    stop: (id: string) => {
      stopped = id;
      return Promise.resolve();
    },
    stopAll: () => Promise.resolve(),
  };
  (sm as any).ptyManager.kill = () => {};
  (sm as any).sessions.set('sess-w', {
    id: 'sess-w',
    name: 'test',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    status: 'running',
    createdAt: new Date().toISOString(),
    pty: {},
    stateDetector: { destroy: () => {}, resize: () => {} },
    outputBuffer: '',
    persistent: false,
    hasUserInputSinceIdle: false,
  });

  await sm.destroySession('sess-w');
  assert.equal(stopped, 'sess-w');
});

test('writeToSession no-ops on an already-exited session instead of writing to a dead pty', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withFakeExitedSession(sm, 'sess-1');
  let writeCalled = false;
  (sm as any).ptyManager.write = () => { writeCalled = true; };

  assert.doesNotThrow(() => sm.writeToSession('sess-1', 'echo hi\n'));
  assert.equal(writeCalled, false);
});

test('writeToSession still throws for a genuinely unknown session id', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  assert.throws(() => sm.writeToSession('does-not-exist', 'x'), /not found/);
});

function withFakeNonTmuxSession(sm: SessionManager, id: string, outputBuffer: string) {
  (sm as any).sessions.set(id, {
    id,
    name: 'test',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    status: 'running',
    createdAt: new Date().toISOString(),
    pty: {},
    stateDetector: { resize: () => {} },
    outputBuffer,
    persistent: false,
    hasUserInputSinceIdle: false,
  });
}

test('getReplaySnapshot reuses a cached frame within the TTL instead of re-capturing', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withFakeNonTmuxSession(sm, 'sess-2', 'first-snapshot');
  assert.equal(sm.getReplaySnapshot('sess-2')?.data, 'first-snapshot');

  (sm as any).sessions.get('sess-2').outputBuffer = 'second-snapshot';
  assert.equal(sm.getReplaySnapshot('sess-2')?.data, 'first-snapshot', 'expected cached frame, not a fresh capture');
});

test('getReplaySnapshot captures fresh once the cache entry is stale', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withFakeNonTmuxSession(sm, 'sess-3', 'first-snapshot');
  sm.getReplaySnapshot('sess-3');

  (sm as any).replaySnapshotCache.get('sess-3').capturedAt = Date.now() - 1000;
  (sm as any).sessions.get('sess-3').outputBuffer = 'second-snapshot';
  assert.equal(sm.getReplaySnapshot('sess-3')?.data, 'second-snapshot');
});

test('persistSessions serializes concurrent writes and always persists the latest state (no stale overwrite)', async () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const calls: string[][] = [];
  let inFlight = false;
  let overlapped = false;
  (sm as any).store.save = async (data: Array<{ id: string }>) => {
    if (inFlight) overlapped = true;
    inFlight = true;
    calls.push(data.map((d) => d.id));
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight = false;
  };

  withFakeNonTmuxSession(sm, 'a', '');
  const p1 = (sm as any).persistSessions();
  // Let p1's queued snapshot capture run (it's a microtask) before mutating,
  // as a real create-then-destroy race would: the second write's snapshot
  // must reflect 'b', not a stale copy of 'a' captured too early.
  await new Promise((resolve) => setImmediate(resolve));
  (sm as any).sessions.delete('a');
  withFakeNonTmuxSession(sm, 'b', '');
  const p2 = (sm as any).persistSessions();

  await Promise.all([p1, p2]);
  assert.equal(overlapped, false, 'writes must not run concurrently');
  assert.deepEqual(calls, [['a'], ['b']]);
});

test('persistSessions recovers after a rejected save instead of wedging future writes', async () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const calls: string[][] = [];
  let failNext = true;
  (sm as any).store.save = async (data: Array<{ id: string }>) => {
    calls.push(data.map((d) => d.id));
    if (failNext) {
      failNext = false;
      throw new Error('disk full');
    }
  };

  withFakeNonTmuxSession(sm, 'a', '');
  await assert.rejects((sm as any).persistSessions(), /disk full/);

  withFakeNonTmuxSession(sm, 'b', '');
  await (sm as any).persistSessions();

  assert.deepEqual(calls, [['a'], ['a', 'b']], 'second persist must still run and see the latest session snapshot');
});
