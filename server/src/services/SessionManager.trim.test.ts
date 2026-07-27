import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';
import { TerminalMirror } from './TerminalMirror.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

interface Fixture {
  sm: SessionManager;
  mirror: TerminalMirror;
  sent: Array<{ room: string; event: string; payload: any }>;
  /** ms since the last pty byte, as the detector reports it. Mutable per test. */
  quiet: { ms: number };
  session: any;
  /** Await whatever trim is in flight. */
  settled: () => Promise<void> | undefined;
  /** Run the deferred quiet-check now, instead of waiting out a real 600ms timer. */
  quietCheck: () => void;
  replays: () => number;
}

/** A session whose mirror holds `rows` of screen plus `rows` of history. */
async function fixture(id: string, cols: number, rows: number, config: any = {}): Promise<Fixture> {
  const mirror = new TerminalMirror(cols, rows, 200);
  await mirror.feed(Array.from({ length: rows * 2 }, (_, i) => `hist-line-${i}`).join('\r\n'));
  await mirror.afterWrite();

  const configStore = {
    load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {}, ...config }),
    save: async () => {},
  } as any;
  const sm = new SessionManager(os.tmpdir(), configStore);
  const quiet = { ms: 10_000 };
  const sent: Fixture['sent'] = [];
  (sm as any).io = {
    to: (room: string) => ({ emit: (event: string, payload: any) => { sent.push({ room, event, payload }); } }),
    emit: () => {},
  };
  const session = {
    id, name: 'test', folderPath: os.tmpdir(), agentType: 'claude', flags: [],
    status: 'running', createdAt: new Date().toISOString(),
    pty: { resize: () => {} },
    stateDetector: { resize: () => {}, destroy: () => {}, msSinceLastFeed: () => quiet.ms },
    mirror, outputBuffer: '', persistent: false, hasUserInputSinceIdle: false,
    cols, rows,
  };
  (sm as any).sessions.set(id, session);

  return {
    sm, mirror, sent, quiet, session,
    settled: () => session.trimPromise,
    quietCheck: () => {
      if (session.trimTimer) { clearTimeout(session.trimTimer); session.trimTimer = undefined; }
      (sm as any).runScrollbackTrim(session);
    },
    replays: () => sent.filter((s) => s.event === 'session:replay').length,
  };
}

const historyGone = (sm: SessionManager, id: string): boolean =>
  !/hist-line-0\b/.test(sm.getReplaySnapshot(id)!.data);

test('a width change drops the invalidated history at once, so a joining view opens clean', async () => {
  const f = await fixture('t1', 40, 10);
  assert.equal(historyGone(f.sm, 't1'), false, 'precondition: history present');

  f.sm.resizeSession('t1', 160, 10);
  await f.settled();

  assert.equal(historyGone(f.sm, 't1'), true, 'the join frame must not carry rows wrapped for the old width');
  assert.match(f.sm.getReplaySnapshot('t1')!.data, /hist-line-19/, 'the live screen stays');
  const replay = f.sent.find((s) => s.event === 'session:replay');
  assert.ok(replay, 'watchers are repainted without waiting for their next join');
  assert.equal(replay!.room, 't1');
  assert.equal(replay!.payload.reason, 'refresh',
    'unsolicited frame: a client scrolled up must be free to ignore it');
  clearTimeout(f.session.trimTimer);
  f.mirror.dispose();
});

test('the leftovers the agent repaint pushes into history are trimmed on the following quiet check', async () => {
  const f = await fixture('t2', 40, 10);
  f.sm.resizeSession('t2', 40 * 4, 10);
  await f.settled();
  const afterResize = f.replays();

  // The SIGWINCH repaint: the agent reprints, and its pre-resize copy scrolls up
  // into history as it does. These are the rows the deferred trim exists for.
  await f.mirror.feed('\r\n' + Array.from({ length: 12 }, (_, i) => `stale-repaint-${i}`).join('\r\n'));
  await f.mirror.afterWrite();
  assert.match(f.sm.getReplaySnapshot('t2')!.data, /stale-repaint-0\b/, 'precondition: leftovers in history');

  f.quietCheck();
  await f.settled();

  assert.doesNotMatch(f.sm.getReplaySnapshot('t2')!.data, /stale-repaint-0\b/, 'leftovers gone');
  assert.match(f.sm.getReplaySnapshot('t2')!.data, /stale-repaint-11/, 'the current screen stays');
  assert.equal(f.replays(), afterResize + 1, 'one more repaint, not a storm');
  f.mirror.dispose();
});

test('a quiet check while output is still streaming re-arms instead of trimming mid-repaint', async () => {
  const f = await fixture('t3', 40, 10);
  f.sm.resizeSession('t3', 160, 10);
  await f.settled();
  const afterResize = f.replays();
  f.quiet.ms = 10; // agent is mid-repaint: its stale rows are still landing

  f.quietCheck();
  await f.settled();

  assert.equal(f.replays(), afterResize, 'no trim while the repaint is in flight');
  assert.ok(f.session.trimTimer, 'the quiet-check re-armed itself');

  f.quiet.ms = 10_000; // output stopped
  f.quietCheck();
  await f.settled();

  assert.equal(f.replays(), afterResize + 1, 'trims on the next quiet check');
  clearTimeout(f.session.trimTimer);
  f.mirror.dispose();
});

test('a quiet check keeps trimming a session that never goes quiet, once past the max wait', async () => {
  const f = await fixture('t4', 40, 10);
  f.sm.resizeSession('t4', 160, 10);
  await f.settled();
  const afterResize = f.replays();
  f.quiet.ms = 10;                       // streaming, and it is not going to stop
  f.session.trimDeadline = Date.now() - 1; // max wait already elapsed

  f.quietCheck();
  await f.settled();

  assert.equal(f.replays(), afterResize + 1, 'a long stream still gets its trim eventually');
  assert.equal(f.session.trimTimer, undefined, 'and stops re-arming');
  f.mirror.dispose();
});

test('a rows-only resize leaves scrollback alone (no rewrap, nothing stale)', async () => {
  const f = await fixture('t5', 40, 10);

  f.sm.resizeSession('t5', 40, 40);
  await f.settled();

  assert.equal(historyGone(f.sm, 't5'), false);
  assert.equal(f.session.trimTimer, undefined, 'no quiet-check armed either');
  assert.equal(f.replays(), 0);
  f.mirror.dispose();
});

test('trimScrollbackOnResize: false keeps the history a width change invalidated', async () => {
  const f = await fixture('t6', 40, 10, { trimScrollbackOnResize: false });

  f.sm.resizeSession('t6', 160, 10);
  await f.settled();

  assert.equal(historyGone(f.sm, 't6'), false, "opted out — stale rows are the user's choice");
  assert.equal(f.replays(), 0, 'and no unsolicited repaint');
  clearTimeout(f.session.trimTimer);
  f.mirror.dispose();
});

test('destroying a session cancels its pending trim instead of firing into a dead session', async () => {
  const f = await fixture('t7', 40, 10);
  (f.sm as any).ptyManager.kill = () => {};
  (f.sm as any).fileWatcher = { watch: () => {}, stop: async () => {}, stopAll: async () => {} };

  f.sm.resizeSession('t7', 160, 10);
  assert.ok(f.session.trimTimer, 'precondition: the width change armed a quiet-check');
  await f.sm.destroySession('t7');

  assert.equal(f.session.trimTimer, undefined, 'the pending quiet-check must be cleared');
  f.mirror.dispose();
});
