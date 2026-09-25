import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager, IDLE_MIN_ROWS, SPAWN_COLS, SPAWN_ROWS } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux'; // pin backend so a built argusd binary doesn't flip the default

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

interface Calls {
  pty: Array<{ cols: number; rows: number }>;
  detector: Array<{ cols: number; rows: number }>;
}

/** A running session with a known grid plus spies on both resize targets. */
function withSizedSession(sm: SessionManager, id: string, cols: number, rows: number): Calls {
  const calls: Calls = { pty: [], detector: [] };
  (sm as any).sessions.set(id, {
    id, name: 'test', folderPath: os.tmpdir(), agentType: 'claude', flags: [],
    status: 'running', createdAt: new Date().toISOString(),
    pty: { resize: (c: number, r: number) => { calls.pty.push({ cols: c, rows: r }); } },
    stateDetector: {
      resize: (c: number, r: number) => { calls.detector.push({ cols: c, rows: r }); },
      msSinceLastFeed: () => 10_000, // quiet, as the real detector reports for an idle pty
    },
    outputBuffer: '', persistent: false, hasUserInputSinceIdle: false,
    cols, rows,
  });
  return calls;
}

test('resizeSession ignores a repeat of the current geometry (no SIGWINCH churn, no detector grace stamp)', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const calls = withSizedSession(sm, 'sess-same', 120, 30);

  sm.resizeSession('sess-same', 120, 30);

  assert.deepEqual(calls.pty, [], 'pty must not be resized to the size it already has');
  assert.deepEqual(calls.detector, [], 'detector grace window must not be re-stamped');
});

test('resizeSession applies a genuinely different geometry', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const calls = withSizedSession(sm, 'sess-diff', 120, 30);

  sm.resizeSession('sess-diff', 200, 50);

  assert.deepEqual(calls.pty, [{ cols: 200, rows: 50 }]);
  assert.deepEqual(calls.detector, [{ cols: 200, rows: 50 }]);
  // The width change also armed the stale-scrollback trim; that behavior lives in
  // SessionManager.trim.test.ts, so don't leave its timer running past this test.
  clearTimeout((sm as any).sessions.get('sess-diff').trimTimer);
});

test('applyIdleGeometry floors the rows of an unattached session, leaving cols alone', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const calls = withSizedSession(sm, 'sess-short', 62, 14);

  sm.applyIdleGeometry('sess-short');

  assert.deepEqual(calls.pty, [{ cols: 62, rows: IDLE_MIN_ROWS }],
    'a minimized tile must not leave the agent rendering into a 14-row screen');
});

test('applyIdleGeometry leaves an already-tall session untouched', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const calls = withSizedSession(sm, 'sess-tall', 200, IDLE_MIN_ROWS + 10);

  sm.applyIdleGeometry('sess-tall');

  assert.deepEqual(calls.pty, [], 'no resize when the pane is already at least the floor');
});

test('applyIdleGeometry floors a session no client ever sized, using the spawn grid', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const calls = withSizedSession(sm, 'sess-virgin', SPAWN_COLS, SPAWN_ROWS);
  // A session created but never attached carries no client-reported grid.
  delete (sm as any).sessions.get('sess-virgin').cols;
  delete (sm as any).sessions.get('sess-virgin').rows;

  sm.applyIdleGeometry('sess-virgin');

  assert.ok(SPAWN_ROWS < IDLE_MIN_ROWS, 'spawn grid is shorter than the floor, or this test proves nothing');
  assert.deepEqual(calls.pty, [{ cols: SPAWN_COLS, rows: IDLE_MIN_ROWS }]);
});

test('applyIdleGeometry is a no-op for an unknown session', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  assert.doesNotThrow(() => sm.applyIdleGeometry('nope'));
});

// A native overlay (Electron main, in-process) never joins the socket room, so
// the idle-geometry gate has to be told about it — otherwise a session viewed
// natively reads as unwatched and gets its pty shrunk under the live view.
test('a natively viewed session is not given the idle geometry', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const calls = withSizedSession(sm, 'sess-native', 100, 14);
  sm.setNativeViewer('sess-native', true);

  sm.applyIdleGeometry('sess-native');

  assert.deepEqual(calls.pty, [], 'the native view is still at its real height');
});

test('a native viewer arriving cancels a pending idle resize, and one cannot be scheduled while it watches', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withSizedSession(sm, 'sess-native-2', 100, 14);
  const gate = (sm as any).idleGeometry;
  const scheduled: string[] = [];
  const cancelled: string[] = [];
  gate.schedule = (id: string) => scheduled.push(id);
  gate.cancel = (id: string) => cancelled.push(id);

  sm.setNativeViewer('sess-native-2', true);
  sm.scheduleIdleGeometry('sess-native-2');

  assert.deepEqual(cancelled, ['sess-native-2']);
  assert.deepEqual(scheduled, []);
});

test('the last native viewer leaving an empty room arms the idle resize; a room with sockets does not', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withSizedSession(sm, 'sess-empty', 100, 14);
  withSizedSession(sm, 'sess-busy', 100, 14);
  const rooms = new Map([['sess-busy', new Set(['socket-1'])]]);
  (sm as any).io = { sockets: { adapter: { rooms } } };
  const gate = (sm as any).idleGeometry;
  const scheduled: string[] = [];
  gate.schedule = (id: string) => scheduled.push(id);
  gate.cancel = () => {};

  sm.setNativeViewer('sess-empty', true);
  sm.setNativeViewer('sess-busy', true);
  sm.setNativeViewer('sess-empty', false);
  sm.setNativeViewer('sess-busy', false);
  sm.setNativeViewer('sess-empty', false);   // a repeat is not a second departure

  assert.deepEqual(scheduled, ['sess-empty']);
});
