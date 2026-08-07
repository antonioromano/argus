import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';
import { TerminalMirror } from './TerminalMirror.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

const WIDE = 160;
const NARROW = 60;
const ROWS = 10;

/** A row of `label`-prefixed filler wide enough to reflow when the pty narrows. */
const row = (label: string): string => `${label} ${'.'.repeat(WIDE - label.length - 10)}`;

/** Rows the agent never reprints — deleting these would be data loss. */
const HEAD = Array.from({ length: 5 }, (_, i) => row(`head-${i}`));
/** The recent transcript the agent reprints on SIGWINCH. */
const BODY = Array.from({ length: 12 }, (_, i) => row(`body-${i}`));

/** Hard-wrap to `width`, the way an agent printing to a pty does. */
const hardWrap = (rows: string[], width: number): string[] =>
  rows.flatMap((r) => {
    const out: string[] = [];
    for (let i = 0; i < r.length; i += width) out.push(r.slice(i, i + width));
    return out;
  });

interface Fixture {
  sm: SessionManager;
  mirror: TerminalMirror;
  sent: Array<{ room: string; event: string; payload: any }>;
  /** ms since the last pty byte, as the detector reports it. Mutable per test. */
  quiet: { ms: number };
  session: any;
  /** Await whatever dedup pass is in flight. */
  settled: () => Promise<void> | undefined;
  /** Run the deferred quiet-check now, instead of waiting out a real 600ms timer. */
  quietCheck: () => void;
  replays: () => number;
  snapshot: () => string;
  /** How many times `token` survives in the frame clients would receive. */
  occurrences: (token: string) => number;
}

async function fixture(id: string, cols = WIDE, rows = ROWS): Promise<Fixture> {
  const mirror = new TerminalMirror(cols, rows, 5000);
  await mirror.feed([...HEAD, ...BODY].join('\r\n'));
  await mirror.afterWrite();

  const configStore = {
    load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
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
    // The real detector owns the mirror resize; the stub must too, or the buffer
    // never reflows and the row indices under test are not the real ones.
    stateDetector: {
      resize: (c: number, r: number) => mirror.resize(c, r),
      destroy: () => {},
      msSinceLastFeed: () => quiet.ms,
    },
    mirror, outputBuffer: '', persistent: false, hasUserInputSinceIdle: false,
    cols, rows,
  };
  (sm as any).sessions.set(id, session);

  const snapshot = () => sm.getReplaySnapshot(id)!.data;
  return {
    sm, mirror, sent, quiet, session, snapshot,
    settled: () => session.trimPromise,
    quietCheck: () => {
      if (session.trimTimer) { clearTimeout(session.trimTimer); session.trimTimer = undefined; }
      (sm as any).runScrollbackTrim(session);
    },
    replays: () => sent.filter((s) => s.event === 'session:replay').length,
    occurrences: (token: string) => snapshot().split(token).length - 1,
  };
}

/** The agent's SIGWINCH repaint: it reprints BODY, hard-wrapped at the new width. */
const reprint = (f: Fixture): Promise<void> =>
  f.mirror.feed('\r\n' + hardWrap(BODY, NARROW).join('\r\n')).then(() => f.mirror.afterWrite());

test('a width change on its own removes nothing — there is no duplicate yet', async () => {
  const f = await fixture('d0');

  f.sm.resizeSession('d0', NARROW, ROWS);
  await f.settled();

  assert.match(f.snapshot(), /head-0/, 'navigation must never eat scroll history');
  assert.match(f.snapshot(), /body-0/);
  assert.equal(f.replays(), 0, 'and no unsolicited repaint');
  clearTimeout(f.session.trimTimer);
  f.mirror.dispose();
});

test("the agent's reprint deletes the stale copy and keeps the history above it", async () => {
  const f = await fixture('d1');
  f.sm.resizeSession('d1', NARROW, ROWS);
  await f.settled();
  await reprint(f);
  assert.equal(f.occurrences('body-0'), 2, 'precondition: the block is duplicated');

  f.quietCheck();
  await f.settled();

  assert.equal(f.occurrences('body-0'), 1, 'exactly one copy of the reprinted block survives');
  assert.equal(f.occurrences('body-11'), 1);
  assert.match(f.snapshot(), /head-0/, 'rows the agent never reprinted are untouched');
  assert.match(f.snapshot(), /head-4/);
  assert.equal(f.replays(), 1, 'one repaint, not a storm');
  const replay = f.sent.find((s) => s.event === 'session:replay');
  assert.equal(replay!.room, 'd1');
  assert.equal(replay!.payload.reason, 'refresh',
    'unsolicited frame: a client scrolled up must be free to ignore it');
  f.mirror.dispose();
});

test('new output that is not a reprint leaves scrollback alone', async () => {
  const f = await fixture('d2');
  f.sm.resizeSession('d2', NARROW, ROWS);
  await f.settled();
  await f.mirror.feed('\r\n' + Array.from({ length: 12 }, (_, i) => row(`fresh-${i}`)).join('\r\n'));
  await f.mirror.afterWrite();

  f.quietCheck();
  await f.settled();

  assert.match(f.snapshot(), /head-0/);
  assert.equal(f.occurrences('body-0'), 1, 'the only copy there ever was stays');
  assert.equal(f.replays(), 0, 'no match, no rebuild, no repaint');
  f.mirror.dispose();
});

test('a quiet check while output is still streaming re-arms instead of cutting mid-repaint', async () => {
  const f = await fixture('d3');
  f.sm.resizeSession('d3', NARROW, ROWS);
  await f.settled();
  await reprint(f);
  f.quiet.ms = 10; // agent is mid-repaint: more rows are still landing

  f.quietCheck();
  await f.settled();

  assert.equal(f.replays(), 0, 'nothing removed while the repaint is in flight');
  assert.ok(f.session.trimTimer, 'the quiet-check re-armed itself');

  f.quiet.ms = 10_000; // output stopped
  f.quietCheck();
  await f.settled();

  assert.equal(f.replays(), 1, 'dedups on the next quiet check');
  assert.equal(f.occurrences('body-0'), 1);
  clearTimeout(f.session.trimTimer);
  f.mirror.dispose();
});

test('a session that never goes quiet still gets deduped once past the max wait', async () => {
  const f = await fixture('d4');
  f.sm.resizeSession('d4', NARROW, ROWS);
  await f.settled();
  await reprint(f);
  f.quiet.ms = 10;                         // streaming, and it is not going to stop
  f.session.trimDeadline = Date.now() - 1; // max wait already elapsed

  f.quietCheck();
  await f.settled();

  assert.equal(f.occurrences('body-0'), 1, 'a long stream is not excluded forever');
  assert.equal(f.session.trimTimer, undefined, 'and stops re-arming');
  f.mirror.dispose();
});

test('a rows-only resize schedules nothing — no rewrap, so nothing can go stale', async () => {
  const f = await fixture('d5');

  f.sm.resizeSession('d5', WIDE, 40);
  await f.settled();

  assert.match(f.snapshot(), /head-0/);
  assert.equal(f.session.trimTimer, undefined, 'no quiet-check armed');
  assert.equal(f.replays(), 0);
  f.mirror.dispose();
});

test('a burst of width changes dedups once, not once per step', async () => {
  const f = await fixture('d6');

  f.sm.resizeSession('d6', 120, ROWS);
  f.sm.resizeSession('d6', 90, ROWS);
  f.sm.resizeSession('d6', NARROW, ROWS);
  await f.settled();
  await reprint(f);
  f.quietCheck();
  await f.settled();

  assert.equal(f.replays(), 1, 'one rebuild for the whole drag');
  assert.equal(f.occurrences('body-0'), 1);
  f.mirror.dispose();
});

test('destroying a session cancels its pending dedup instead of firing into a dead session', async () => {
  const f = await fixture('d7');
  (f.sm as any).ptyManager.kill = () => {};
  (f.sm as any).fileWatcher = { watch: () => {}, stop: async () => {}, stopAll: async () => {} };

  f.sm.resizeSession('d7', NARROW, ROWS);
  assert.ok(f.session.trimTimer, 'precondition: the width change armed a quiet-check');
  await f.sm.destroySession('d7');

  assert.equal(f.session.trimTimer, undefined, 'the pending quiet-check must be cleared');
  f.mirror.dispose();
});
