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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Fixture {
  sm: SessionManager;
  session: any;
  emits: Array<{ event: string; payload: any }>;
  feed: (data: string) => void;
}

/**
 * A mirror-backed session wired to a fake io, plus the onData path the pty
 * would drive. Mirrors what createSession installs, minus the pty.
 */
function fixture(id: string): Fixture {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const mirror = new TerminalMirror(80, 24, 500);
  const emits: Fixture['emits'] = [];
  (sm as any).io = {
    to: () => ({ emit: (event: string, payload: any) => emits.push({ event, payload }) }),
    emit: (event: string, payload: any) => emits.push({ event, payload }),
  };
  const session: any = {
    id,
    name: 'resync',
    folderPath: os.tmpdir(),
    agentType: 'claude',
    flags: [],
    status: 'running',
    createdAt: new Date().toISOString(),
    pty: {},
    stateDetector: { resize: () => {}, feed: () => {} },
    mirror,
    outputBuffer: '',
    persistent: true,
    hasUserInputSinceIdle: false,
  };
  (sm as any).sessions.set(id, session);

  // The slice of createSession's onData that resync affects.
  const feed = (data: string) => {
    void session.mirror.feed(data);
    if (session.resyncing) {
      (sm as any).armResyncSettle(session);
      return;
    }
    (sm as any).emitOutput(session, data);
  };
  return { sm, session, emits, feed };
}

test('a reseed withholds the replayed history from clients instead of pasting it twice', async () => {
  const f = fixture('r1');

  f.sm.beginResync('r1');
  f.feed('replayed history line\r\n');
  await sleep(50);

  const outputs = f.emits.filter((e) => e.event === 'session:output');
  assert.deepEqual(outputs, [], 'ring replay must not reach clients as fresh output');
  assert.equal(f.session.resyncing, true, 'still inside the reseed window');
});

test('a reseed ends with one authoritative frame, and live output resumes', async () => {
  const f = fixture('r2');

  f.sm.beginResync('r2');
  f.feed('replayed history\r\n');
  await sleep(400); // quiet → window closes

  const replays = f.emits.filter((e) => e.event === 'session:replay');
  assert.equal(replays.length, 1, 'exactly one frame closes the reseed');
  assert.equal(replays[0]!.payload.reason, 'refresh');
  assert.equal(f.session.resyncing, false);

  f.emits.length = 0;
  f.feed('live again\r\n');
  (f.sm as any).flushOutput('r2');
  assert.ok(
    f.emits.some((e) => e.event === 'session:output'),
    'live output must flow again once the reseed window closes',
  );
});

// The trap this hit in practice: the settle timer is re-armed by every chunk, so
// a session that streams continuously never goes quiet. Without the hard cap its
// output is withheld forever and the terminal stays blank — precisely for the
// busy sessions a reconnect matters most for.
test('a session that never goes quiet still leaves the reseed window', async () => {
  const f = fixture('r3');

  f.sm.beginResync('r3');
  const stream = setInterval(() => f.feed('still streaming\r\n'), 25);
  await sleep(2200); // longer than RESYNC_MAX_MS
  clearInterval(stream);

  assert.equal(f.session.resyncing, false, 'the hard cap must close the window on a busy session');
  f.emits.length = 0;
  f.feed('after cap\r\n');
  (f.sm as any).flushOutput('r3');
  assert.ok(
    f.emits.some((e) => e.event === 'session:output'),
    'output must reach clients again after the cap',
  );
});
