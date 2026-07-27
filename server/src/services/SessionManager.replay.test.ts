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

/**
 * Spy every tmux read `getReplaySnapshot` used to make, then inject a
 * mirror-backed session. Returns the manager, the mirror, and a live call
 * counter so tests can assert the replay path is tmux-free.
 */
function mgrWithMirrorSession(id: string, mirror: TerminalMirror): { sm: SessionManager; tmuxCalls: () => number } {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  let calls = 0;
  const pm = (sm as any).ptyManager;
  for (const m of ['capturePane', 'captureState', 'exitCopyMode', 'isTmuxPaneDead']) {
    pm[m] = () => {
      calls++;
      return m === 'captureState' ? { cursorX: 0, cursorY: 0, alternate: false, appMouse: false, sgr: true } : '';
    };
  }
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
    mirror,
    outputBuffer: 'RAW-FALLBACK',
    tmuxName: `argus-${id}`,
    persistent: true,
    hasUserInputSinceIdle: false,
  });
  return { sm, tmuxCalls: () => calls };
}

test('getReplaySnapshot serves the mirror screen with the reconcile prefix, no tmux calls', async () => {
  const mirror = new TerminalMirror(40, 10, 200);
  await mirror.feed('hello world\r\nprompt> ');
  await mirror.afterWrite();

  const { sm, tmuxCalls } = mgrWithMirrorSession('s1', mirror);
  const frame = sm.getReplaySnapshot('s1');

  assert.ok(frame, 'frame returned');
  assert.equal(tmuxCalls(), 0, 'replay must not shell out to tmux');
  assert.ok(
    frame!.data.startsWith('\x1b[?1049l\x1b[2J\x1b[3J\x1b[H'),
    'frame must lead with the reconcile prefix',
  );
  assert.match(frame!.data, /hello world/, 'serialized screen content present');
  assert.match(frame!.data, /prompt> /, 'current input line present');
  assert.notEqual(frame!.data, 'RAW-FALLBACK', 'must serve mirror, not the raw buffer');
  mirror.dispose();
});

test('getReplaySnapshot reflects alternate + SGR mouse mode from the mirror', async () => {
  const mirror = new TerminalMirror(40, 10, 200);
  await mirror.feed('\x1b[?1006h'); // SGR mouse encoding
  await mirror.feed('\x1b[?1049h'); // enter alt buffer
  await mirror.afterWrite();

  const { sm } = mgrWithMirrorSession('s2', mirror);
  const frame = sm.getReplaySnapshot('s2');

  assert.equal(frame!.alternate, true, 'alternate reflects alt buffer');
  assert.equal(frame!.sgr, true, 'sgr reflects ?1006h');
  mirror.dispose();
});

test('reconnect storm: N joins do zero tmux subprocess calls (no TTL cache needed)', async () => {
  const mirror = new TerminalMirror(40, 10, 200);
  await mirror.feed('storm test\r\n');
  await mirror.afterWrite();

  const { sm, tmuxCalls } = mgrWithMirrorSession('s3', mirror);
  const frames = [];
  for (let i = 0; i < 50; i++) frames.push(sm.getReplaySnapshot('s3'));

  assert.equal(tmuxCalls(), 0, '50 rejoins must trigger 0 tmux captures');
  assert.equal(frames.filter((f) => f && /storm test/.test(f.data)).length, 50, 'every join gets a valid frame');
  mirror.dispose();
});

test('clearBuffer wipes the mirror history so the stale rows cannot come back on the next join', async () => {
  const mirror = new TerminalMirror(40, 10, 200);
  const lines = Array.from({ length: 20 }, (_, i) => `hist-line-${i}`);
  await mirror.feed(lines.join('\r\n'));
  await mirror.afterWrite();
  const { sm } = mgrWithMirrorSession('s5', mirror);
  assert.match(sm.getReplaySnapshot('s5')!.data, /hist-line-0/, 'precondition: history is in the frame');

  await sm.clearBuffer('s5');

  const frame = sm.getReplaySnapshot('s5')!;
  assert.doesNotMatch(frame.data, /hist-line-0\b/, 'cleared history must not be served again');
  assert.match(frame.data, /hist-line-19/, 'the visible screen survives the clear');
  assert.equal((sm as any).sessions.get('s5').outputBuffer, '', 'raw rolling buffer cleared too');
  mirror.dispose();
});

test('clearBuffer repaints the clients already in the room, not just the one that asked', async () => {
  const mirror = new TerminalMirror(40, 10, 200);
  await mirror.feed(Array.from({ length: 20 }, (_, i) => `hist-line-${i}`).join('\r\n'));
  await mirror.afterWrite();
  const { sm } = mgrWithMirrorSession('s6', mirror);
  const sent: Array<{ room: string; event: string; payload: any }> = [];
  (sm as any).io = {
    to: (room: string) => ({
      emit: (event: string, payload: any) => { sent.push({ room, event, payload }); },
    }),
    emit: () => {},
  };

  await sm.clearBuffer('s6');

  const replay = sent.find((s) => s.event === 'session:replay');
  assert.ok(replay, 'every watcher gets an authoritative frame');
  assert.equal(replay!.room, 's6');
  assert.doesNotMatch(replay!.payload.data, /hist-line-0\b/);
  assert.match(replay!.payload.data, /hist-line-19/);
  mirror.dispose();
});

test('getReplaySnapshot falls back to the raw buffer when the mirror throws', async () => {
  const mirror = new TerminalMirror(40, 10, 200);
  mirror.dispose(); // disposed → serialize() returns '' (not a throw); force a throw instead
  const { sm } = mgrWithMirrorSession('s4', mirror);
  // Replace the mirror with one whose serialize throws, to exercise the catch.
  (sm as any).sessions.get('s4').mirror = {
    bufferType: () => 'normal',
    modes: () => ({ appMouse: false, sgr: true }),
    serialize: () => {
      throw new Error('boom');
    },
  };
  const frame = sm.getReplaySnapshot('s4');
  assert.equal(frame!.data, 'RAW-FALLBACK', 'falls back to the raw rolling buffer on mirror failure');
});
