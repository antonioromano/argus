import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';
import { TerminalMirror } from './TerminalMirror.js';

process.env.ARGUS_PTY_BACKEND = 'tmux'; // pin backend so a built argusd binary doesn't flip the default

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

async function exitedSession(id: string) {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const mirror = new TerminalMirror(40, 10, 200);
  await mirror.feed(Array.from({ length: 20 }, (_, i) => `hist-line-${i}`).join('\r\n'));
  const pty = {};
  let detectorDestroyed = false;
  const stopped: string[] = [];
  (sm as any).fileWatcher = { stop: async (sid: string) => { stopped.push(sid); }, watch: () => {}, stopAll: async () => {} };
  const session: any = {
    id,
    name: 'exited',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    status: 'exited',
    createdAt: new Date().toISOString(),
    pty,
    stateDetector: { destroy: () => { detectorDestroyed = true; } },
    mirror,
    persistent: false,
    hasUserInputSinceIdle: false,
  };
  (sm as any).sessions.set(id, session);
  return { sm, session, mirror, pty, stopped, detectorDestroyed: () => detectorDestroyed };
}

test('an exited session is frozen into one stored frame and its mirror disposed', async () => {
  const { sm, session, mirror, pty, stopped, detectorDestroyed } = await exitedSession('x1');
  const before = sm.getReplaySnapshot('x1')!;

  await (sm as any).tierExitedSession(session, pty);

  assert.ok(session.exitedFrame, 'frame stored');
  assert.equal((mirror as any).destroyed, true, 'headless xterm disposed');
  assert.ok(detectorDestroyed(), 'detector destroyed before the mirror it reads');
  assert.deepEqual(stopped, ['x1'], 'folder watcher stopped');
  const after = sm.getReplaySnapshot('x1')!;
  assert.equal(after.data, before.data, 'joins get the identical frame from the stored string');
  const screen = sm.getReplaySnapshot('x1', 'screen')!;
  assert.ok(!screen.data.includes('\x1b[3J'), 'screen flavor still omits ED 3');
  assert.doesNotMatch(screen.data, /hist-line-0\b/);
});

test('clearBuffer on a frozen session drops the stored history, keeps the screen', async () => {
  const { sm, session, pty } = await exitedSession('x2');
  await (sm as any).tierExitedSession(session, pty);
  await sm.clearBuffer('x2');
  const frame = sm.getReplaySnapshot('x2')!;
  assert.doesNotMatch(frame.data, /hist-line-0\b/);
  assert.match(frame.data, /hist-line-19/);
});

test('a session restarted before the freeze fires is left alone', async () => {
  const { sm, session, mirror, pty } = await exitedSession('x3');
  session.pty = {}; // restart swapped the pty
  await (sm as any).tierExitedSession(session, pty);
  assert.equal(session.exitedFrame, undefined);
  assert.equal((mirror as any).destroyed, false, 'live mirror must not be disposed');
  mirror.dispose();
});

test('late resize / dedup paths on a frozen session are inert', async () => {
  const { sm, session, pty } = await exitedSession('x4');
  await (sm as any).tierExitedSession(session, pty);
  sm.resizeSession('x4', 80, 24); // exited → only records the grid
  assert.equal(await (sm as any).dedupeAtBoundary(session, 3), false);
  (sm as any).beginResync('x4');
  await (sm as any).finishResync('x4');
  assert.match(sm.getReplaySnapshot('x4')!.data, /hist-line-19/);
});

test('a restart that begins while the freeze awaits a pending trim is left alone', async () => {
  const { sm, session, mirror, pty, stopped } = await exitedSession('x5');
  let releaseTrim!: () => void;
  session.trimPromise = new Promise<void>((r) => { releaseTrim = r; });
  const tier = (sm as any).tierExitedSession(session, pty);
  // restartSession's synchronous prefix: old mirror disposed, pty not yet swapped.
  mirror.dispose();
  releaseTrim();
  await tier;
  assert.equal(session.exitedFrame, undefined, 'no empty frame frozen onto the restarting session');
  assert.deepEqual(stopped, [], 'folder watcher left running');
});

test('a freeze that lands mid-reseed re-arms instead of keeping the mirror forever', async () => {
  const { sm, session, mirror, pty } = await exitedSession('x6');
  session.resyncing = true;
  await (sm as any).tierExitedSession(session, pty);
  assert.equal(session.exitedFrame, undefined);
  assert.ok(session.tierTimer, 're-armed');
  clearTimeout(session.tierTimer);
  mirror.dispose();
});
