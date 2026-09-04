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

// ---------------------------------------------------------------------------
// Reseed must not cost the user their scrollback.
//
// The reseed used to open by wiping the mirror, on the theory that the ring
// replay would rebuild it. It does not: the agent repaints its UI in place, so
// replaying a 2MB byte tail into an EMPTY screen yields about one screen of
// rows — those same cursor moves originally landed on a screen that had already
// scrolled, and that state is gone. A session idle at reseed time then never
// refills, and sits shallow for the rest of its life (observed: 128 rows).
//
// So the mirror is kept and the overlap is removed afterwards instead, the same
// trade the width-change dedup makes: no confident match means no action, so the
// worst case is a visible duplicate, never missing history.
// ---------------------------------------------------------------------------

/** Feed n numbered lines wide enough to clear MIN_DEDUP_CHARS when matched. */
async function feedLines(f: Fixture, prefix: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) f.feed(`${prefix} line ${i} ${'-'.repeat(40)}\r\n`);
  await f.session.mirror.afterWrite();
}

test('a reseed keeps the scrollback it had instead of wiping it', async () => {
  const f = fixture('r6');
  await feedLines(f, 'history', 40);
  const before = f.session.mirror.totalRows();
  assert.ok(before > 30, 'fixture should have real history to lose');

  f.sm.beginResync('r6');
  f.feed('current screen\r\n');
  await sleep(400);
  await f.session.mirror.afterWrite();

  assert.ok(
    f.session.mirror.totalRows() >= before,
    `reseed destroyed scrollback: ${before} rows before, ${f.session.mirror.totalRows()} after`,
  );
  const rows = f.session.mirror.readRows(0, f.session.mirror.totalRows()).join('\n');
  assert.ok(rows.includes('history line 0'), 'the oldest pre-reseed row must survive');
});

test('a reseed drops the tail the replay reprints, so history is not doubled', async () => {
  const f = fixture('r7');
  await feedLines(f, 'history', 30);
  const before = f.session.mirror.totalRows();

  // The ring replay reprints the transcript it already sent, then the live tail.
  f.sm.beginResync('r7');
  await feedLines(f, 'history', 30);
  f.feed(`fresh output ${'-'.repeat(40)}\r\n`);
  await sleep(400);
  await f.session.mirror.afterWrite();

  const total = f.session.mirror.totalRows();
  assert.ok(
    total < before + 25,
    `the reprinted copy was kept: ${before} rows before, ${total} after a 30-line reprint`,
  );
  const rows = f.session.mirror.readRows(0, total).join('\n');
  assert.ok(rows.includes('history line 0'), 'history itself must remain');
  assert.ok(rows.includes('fresh output'), 'output after the reprint must remain');
});

test('a reseed with nothing matching removes nothing at all', async () => {
  const f = fixture('r8');
  await feedLines(f, 'history', 30);
  const before = f.session.mirror.totalRows();

  f.sm.beginResync('r8');
  f.feed(`unrelated screen ${'-'.repeat(40)}\r\n`);
  await sleep(400);
  await f.session.mirror.afterWrite();

  const rows = f.session.mirror.readRows(0, f.session.mirror.totalRows()).join('\n');
  assert.ok(rows.includes('history line 0'), 'no match must mean no deletion');
  assert.ok(rows.includes('history line 29'), 'including the rows nearest the boundary');
  assert.ok(f.session.mirror.totalRows() > before, 'and the new screen is still appended');
});

test('a reseed still ends with exactly one frame after deduping', async () => {
  const f = fixture('r9');
  await feedLines(f, 'history', 30);

  f.sm.beginResync('r9');
  await feedLines(f, 'history', 30);
  await sleep(400);

  const replays = f.emits.filter((e) => e.event === 'session:replay');
  assert.equal(replays.length, 1, 'the dedup must not add a second frame');
  assert.equal(replays[0]!.payload.reason, 'refresh');
});
