import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager, IDLE_TIER_DELAY_MS } from './SessionManager.js';
import { TerminalMirror } from './TerminalMirror.js';

process.env.ARGUS_PTY_BACKEND = 'tmux'; // pin backend so a built argusd binary doesn't flip the default

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

async function idleSession(id: string, opts: { quiescent?: boolean } = {}) {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const mirror = new TerminalMirror(40, 10, 200);
  await mirror.feed(Array.from({ length: 60 }, (_, i) => `hist-line-${i}`).join('\r\n'));
  const session: any = {
    id,
    name: 'idle',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    status: 'idle',
    createdAt: new Date().toISOString(),
    pty: {},
    stateDetector: { isQuiescent: () => opts.quiescent ?? true, destroy: () => {} },
    mirror,
    persistent: false,
    hasUserInputSinceIdle: false,
  };
  (sm as any).sessions.set(id, session);
  return { sm, session, mirror };
}

/** Minimal stand-in for the socket.io rooms SessionManager counts viewers in. */
function fakeIo(rooms: Map<string, Set<string>>) {
  return { sockets: { adapter: { rooms } }, to: () => ({ emit: () => {} }) } as any;
}

test('an idle session nobody watches sleeps its mirror after the delay, and joins still get the same frame', async () => {
  const { sm, mirror } = await idleSession('i1');
  const before = sm.getReplaySnapshot('i1')!;
  const t0 = 1_000_000;

  sm.sweepIdleTier(t0);
  assert.equal(mirror.hibernated, false, 'not on the first sighting');
  sm.sweepIdleTier(t0 + IDLE_TIER_DELAY_MS - 1);
  assert.equal(mirror.hibernated, false, 'not before the delay');
  sm.sweepIdleTier(t0 + IDLE_TIER_DELAY_MS);
  assert.equal(mirror.hibernated, true);

  assert.equal(sm.getReplaySnapshot('i1')!.data, before.data, 'identical full frame, served without waking');
  assert.equal(mirror.hibernated, true);

  sm.rehydrateMirror('i1'); // what session:join does after answering
  assert.equal(mirror.hibernated, false);
  assert.equal(sm.getReplaySnapshot('i1')!.data, before.data, 'woken mirror serializes the same history');
  mirror.dispose();
});

test('a viewer, a busy status or a pending classification keeps the mirror awake (and resets the clock)', async () => {
  const { sm, session, mirror } = await idleSession('i2');
  const rooms = new Map<string, Set<string>>([['i2', new Set(['sock'])]]);
  (sm as any).io = fakeIo(rooms);
  const t0 = 1_000_000;

  sm.sweepIdleTier(t0);
  sm.sweepIdleTier(t0 + IDLE_TIER_DELAY_MS * 2);
  assert.equal(mirror.hibernated, false, 'watched');

  rooms.delete('i2');
  session.status = 'running';
  sm.sweepIdleTier(t0 + IDLE_TIER_DELAY_MS * 3);
  sm.sweepIdleTier(t0 + IDLE_TIER_DELAY_MS * 5);
  assert.equal(mirror.hibernated, false, 'running');

  session.status = 'done';
  session.stateDetector.isQuiescent = () => false;
  sm.sweepIdleTier(t0 + IDLE_TIER_DELAY_MS * 6);
  sm.sweepIdleTier(t0 + IDLE_TIER_DELAY_MS * 8);
  assert.equal(mirror.hibernated, false, 'classification pending');

  // Eligible from here: the clock starts now, not at the first sweep.
  session.stateDetector.isQuiescent = () => true;
  sm.sweepIdleTier(t0 + IDLE_TIER_DELAY_MS * 9);
  assert.equal(mirror.hibernated, false);
  sm.sweepIdleTier(t0 + IDLE_TIER_DELAY_MS * 10);
  assert.equal(mirror.hibernated, true, 'done + unwatched + quiescent → asleep');
  mirror.dispose();
});

test('a native viewer wakes a sleeping mirror', async () => {
  const { sm, mirror } = await idleSession('i3');
  sm.sweepIdleTier(0);
  sm.sweepIdleTier(IDLE_TIER_DELAY_MS);
  assert.equal(mirror.hibernated, true);
  sm.setNativeViewer('i3', true);
  assert.equal(mirror.hibernated, false);
  mirror.dispose();
});

test('an exited session that slept still freezes into its exited frame', async () => {
  const { sm, session, mirror } = await idleSession('i4');
  sm.sweepIdleTier(0);
  sm.sweepIdleTier(IDLE_TIER_DELAY_MS);
  const before = sm.getReplaySnapshot('i4')!;
  session.status = 'exited';
  (sm as any).fileWatcher = { stop: async () => {}, watch: () => {}, stopAll: async () => {} };
  await (sm as any).tierExitedSession(session, session.pty);
  assert.ok(session.exitedFrame);
  assert.equal(mirror.disposed, true);
  assert.equal(sm.getReplaySnapshot('i4')!.data, before.data);
});
