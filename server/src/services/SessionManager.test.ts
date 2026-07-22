import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';
import { tmuxSessionName } from './PtyManager.js';

// These tests exercise the tmux-delegation path via PtyManager stubs; pin the
// backend so a locally-built argusd binary doesn't flip the default to daemon.
process.env.ARGUS_PTY_BACKEND = 'tmux';

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

function withFakeRunningSession(sm: SessionManager, id: string) {
  (sm as any).sessions.set(id, {
    id, name: 'test', folderPath: os.tmpdir(), agentType: 'claude', flags: [],
    status: 'running', createdAt: new Date().toISOString(),
    pty: {}, tmuxName: tmuxSessionName(id, 'test'),
    stateDetector: { resize: () => {} }, outputBuffer: '',
    persistent: false, hasUserInputSinceIdle: false, suppressDonePromotion: true,
  });
}

test('writeToSession routes a forwarded wheel report to the pane (send-keys -l), not the pty', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withFakeRunningSession(sm, 'sess-wheel');
  let ptyWrite: string | null = null;
  let sentLiteral: { name: string; data: string } | null = null;
  (sm as any).ptyManager.write = (_p: unknown, d: string) => { ptyWrite = d; };
  (sm as any).ptyManager.sendKeysLiteral = (name: string, data: string) => { sentLiteral = { name, data }; };

  // SGR wheel-up report as the client forwards it
  sm.writeToSession('sess-wheel', '\x1b[<64;1;1M');
  assert.equal(ptyWrite, null, 'wheel must NOT be written to the tmux client input (tmux drops it)');
  assert.ok(sentLiteral, 'wheel must be delivered to the pane via send-keys -l');
  assert.equal((sentLiteral as any).data, '\x1b[<64;1;1M');

  // Scrolling is not user input: it must not trip the done-promotion guard.
  const sess = (sm as any).sessions.get('sess-wheel');
  assert.equal(sess.hasUserInputSinceIdle, false);
  assert.equal(sess.suppressDonePromotion, true, 'scroll must not touch state guards');
});

test('writeToSession sends real keystrokes to the pty, not send-keys -l', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withFakeRunningSession(sm, 'sess-keys');
  let ptyWrite: string | null = null;
  let literalCalled = false;
  // writeToSession now writes straight to the pty (session.pty.write); the wheel
  // path goes through the backend, which for tmux uses sendKeysLiteral.
  (sm as any).sessions.get('sess-keys').pty.write = (d: string) => { ptyWrite = d; };
  (sm as any).ptyManager.sendKeysLiteral = () => { literalCalled = true; };

  sm.writeToSession('sess-keys', 'echo hi\n');
  assert.equal(ptyWrite, 'echo hi\n');
  assert.equal(literalCalled, false);
  // A left-click report (button 0) is NOT a wheel report — must go to the pty.
  ptyWrite = null;
  sm.writeToSession('sess-keys', '\x1b[<0;5;5M');
  assert.equal(ptyWrite, '\x1b[<0;5;5M');
  assert.equal(literalCalled, false);
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

test('getReplaySnapshot returns a fresh frame each call (no TTL cache)', () => {
  // The TTL snapshot cache was removed with the move to mirror.serialize()
  // (plan 002 Unit 2): serving is an in-memory read, so every join reflects the
  // latest state immediately. These fakes carry no mirror, exercising the
  // raw-buffer fallback path — enough to prove there is no stale caching.
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withFakeNonTmuxSession(sm, 'sess-2', 'first-snapshot');
  assert.equal(sm.getReplaySnapshot('sess-2')?.data, 'first-snapshot');

  (sm as any).sessions.get('sess-2').outputBuffer = 'second-snapshot';
  assert.equal(
    sm.getReplaySnapshot('sess-2')?.data,
    'second-snapshot',
    'no cache — a fresh call reflects the latest state immediately',
  );
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

test('restoreSessions calls spawnTmux exactly once when reattaching to a live survivor', async () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  (sm as any).fileWatcher = { watch: () => {}, stop: () => Promise.resolve(), stopAll: () => Promise.resolve() };
  (sm as any).store.load = async () => ([{
    id: 'restore-1',
    name: 'restored',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    createdAt: new Date().toISOString(),
  }]);
  (sm as any).store.save = async () => {};

  const tmuxName = tmuxSessionName('restore-1');
  const fakePty = { onData: () => {}, onExit: () => {}, kill: () => {} };
  let spawnTmuxCalls = 0;
  (sm as any).ptyManager.isTmuxAvailable = () => true;
  (sm as any).ptyManager.listArgusSessions = () => new Set([tmuxName]);
  (sm as any).ptyManager.isTmuxPaneDead = () => false;
  (sm as any).ptyManager.spawnTmux = () => { spawnTmuxCalls++; return fakePty; };

  await sm.restoreSessions();

  assert.equal(spawnTmuxCalls, 1, 'reattach path must spawn exactly one client onto the survivor session');
});
