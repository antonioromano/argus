import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Terminal as XTerminal, ITerminalOptions, ITerminalInitOnlyOptions } from '@xterm/headless';
import xtermHeadless from '@xterm/headless';
import { TerminalMirror } from './TerminalMirror.js';

const Terminal = (xtermHeadless as unknown as {
  Terminal: new (opts?: ITerminalOptions & ITerminalInitOnlyOptions) => XTerminal;
}).Terminal;

const COLS = 40;
const ROWS = 10;
const SCROLLBACK = 200;

const write = (t: XTerminal, data: string): Promise<void> =>
  new Promise((resolve) => t.write(data, () => resolve()));

const freshTerm = (): XTerminal =>
  new Terminal({ cols: COLS, rows: ROWS, scrollback: SCROLLBACK, allowProposedApi: true });

interface RowSnap {
  text: string;
  isWrapped: boolean;
  cells: string;
}
interface Snap {
  type: string;
  cursorX: number;
  cursorY: number;
  length: number;
  rows: RowSnap[];
}

function snapshot(t: XTerminal): Snap {
  const buf = t.buffer.active;
  const rows: RowSnap[] = [];
  for (let y = 0; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) break;
    const cells: string[] = [];
    for (let x = 0; x < COLS; x++) {
      const c = line.getCell(x);
      cells.push(`${c?.getChars() ?? ''}:${c?.getWidth() ?? 0}`);
    }
    rows.push({ text: line.translateToString(true), isWrapped: line.isWrapped, cells: cells.join('|') });
  }
  return { type: buf.type, cursorX: buf.cursorX, cursorY: buf.cursorY, length: buf.length, rows };
}

function diff(a: Snap, b: Snap): string[] {
  const out: string[] = [];
  if (a.type !== b.type) out.push(`buffer type: ${a.type} vs ${b.type}`);
  if (a.cursorX !== b.cursorX || a.cursorY !== b.cursorY)
    out.push(`cursor: (${a.cursorX},${a.cursorY}) vs (${b.cursorX},${b.cursorY})`);
  if (a.length !== b.length) out.push(`length: ${a.length} vs ${b.length}`);
  for (let y = 0; y < Math.min(a.rows.length, b.rows.length); y++) {
    if (a.rows[y]!.text !== b.rows[y]!.text)
      out.push(`row ${y} text: ${JSON.stringify(a.rows[y]!.text)} vs ${JSON.stringify(b.rows[y]!.text)}`);
    if (a.rows[y]!.isWrapped !== b.rows[y]!.isWrapped)
      out.push(`row ${y} isWrapped: ${a.rows[y]!.isWrapped} vs ${b.rows[y]!.isWrapped}`);
    if (a.rows[y]!.cells !== b.rows[y]!.cells) out.push(`row ${y} cells differ`);
  }
  return out;
}

/** Feed a stream into a mirror, serialize, replay into a fresh term, assert grid equality. */
async function roundtrip(feed: (m: TerminalMirror) => Promise<void>): Promise<string[]> {
  const mirror = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  await feed(mirror);
  await mirror.afterWrite();
  const frame = mirror.serialize();

  const dst = freshTerm();
  await write(dst, frame);

  const d = diff(snapshot(mirror.term), snapshot(dst));
  mirror.dispose();
  dst.dispose();
  return d;
}

// ---------------------------------------------------------------------------
// Round-trip fidelity (Q4) — the grid must survive serialize → replay.
// ---------------------------------------------------------------------------

test('round-trip: alt-buffer (vim-like) restores exactly', async () => {
  const d = await roundtrip(async (m) => {
    await m.feed('shell$ ls\r\nfileA fileB\r\nshell$ vim notes.txt\r\n');
    await m.feed('\x1b[?1049h\x1b[2J\x1b[H');
    await m.feed('\x1b[1;1Hline one of file\x1b[2;1Hline two of file');
    await m.feed(`\x1b[${ROWS};1H\x1b[7m-- INSERT --\x1b[0m`);
    await m.feed('\x1b[2;5H');
  });
  assert.deepEqual(d, [], `alt-buffer diffs:\n${d.join('\n')}`);
});

test('round-trip: alt-buffer exit restores the normal buffer', async () => {
  const d = await roundtrip(async (m) => {
    await m.feed('before-vim line 1\r\nbefore-vim line 2\r\n');
    await m.feed('\x1b[?1049h\x1b[2J\x1b[Hvim content');
    await m.feed('\x1b[?1049l');
  });
  assert.deepEqual(d, [], `alt-exit diffs:\n${d.join('\n')}`);
});

test('round-trip: wrapped-line continuity survives', async () => {
  const d = await roundtrip(async (m) => {
    const long = Array.from({ length: COLS * 3 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
    await m.feed(`${long}\r\n${'x'.repeat(COLS)}\r\nshort\r\n`);
  });
  assert.deepEqual(d, [], `wrapped diffs:\n${d.join('\n')}`);
});

test('round-trip: wide glyphs / emoji / ZWJ hold column widths', async () => {
  const d = await roundtrip(async (m) => {
    await m.feed('汉字テストひらがな한글\r\nemoji: 🚀🔥✅\r\n');
    await m.feed('zwj: 👨‍👩‍👧‍👦 flag: 🇮🇹 mod: 👍🏽\r\nmix: a汉b字c🚀d\r\n');
    await m.feed(`${'汉'.repeat(COLS)}\r\n`);
  });
  assert.deepEqual(d, [], `wide-glyph diffs:\n${d.join('\n')}`);
});

test('round-trip: colors + SGR attributes survive', async () => {
  const d = await roundtrip(async (m) => {
    await m.feed('\x1b[1;31mbold red\x1b[0m \x1b[38;5;208m256-orange\x1b[0m\r\n');
    await m.feed('\x1b[38;2;100;200;50mtruecolor\x1b[0m \x1b[7minverse\x1b[0m \x1b[4munder\x1b[0m\r\n');
  });
  assert.deepEqual(d, [], `sgr diffs:\n${d.join('\n')}`);
});

test('round-trip: scrollback beyond the viewport survives', async () => {
  const d = await roundtrip(async (m) => {
    for (let i = 0; i < ROWS * 3; i++) await m.feed(`scroll line ${i}\r\n`);
  });
  assert.deepEqual(d, [], `scrollback diffs:\n${d.join('\n')}`);
});

test('round-trip: precise cursor position (no trailing newline)', async () => {
  const d = await roundtrip(async (m) => {
    await m.feed('prompt> partial-input');
  });
  assert.deepEqual(d, [], `cursor diffs:\n${d.join('\n')}`);
});

test('survivor seed: history beyond the screen lands in scrollback and round-trips (U3)', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  // A capture-pane seed of history + screen: 2× the viewport height of lines.
  const lines = Array.from({ length: ROWS * 2 }, (_, i) => `hist-line-${i}`);
  await m.feed(lines.join('\r\n'));
  await m.afterWrite();
  const frame = m.serialize();
  const dst = freshTerm();
  await write(dst, frame);
  const d = diff(snapshot(m.term), snapshot(dst));
  assert.deepEqual(d, [], `seeded scrollback must round-trip:\n${d.join('\n')}`);
  assert.ok(snapshot(m.term).length > ROWS, 'seed produced scrollback beyond the visible screen');
  assert.equal(m.seeding, false, 'seeding flag is off by default');
  m.dispose();
});

test('clearScrollback drops the history rows and keeps the visible screen', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  const lines = Array.from({ length: ROWS * 2 }, (_, i) => `hist-line-${i}`);
  await m.feed(lines.join('\r\n'));
  await m.afterWrite();
  assert.ok(snapshot(m.term).length > ROWS, 'precondition: the feed produced scrollback');

  await m.clearScrollback();

  assert.equal(snapshot(m.term).length, ROWS, 'buffer is down to the visible screen');
  const frame = m.serialize();
  assert.ok(!frame.includes('hist-line-0'), 'the oldest row must not survive into the replay frame');
  assert.ok(frame.includes(`hist-line-${ROWS * 2 - 1}`), 'the current screen must survive');
  m.dispose();
});

test('clearScrollback on a mirror with no history leaves the screen untouched', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  await m.feed('one\r\ntwo\r\nprompt> ');
  await m.afterWrite();
  const before = snapshot(m.term);

  await m.clearScrollback();

  assert.deepEqual(diff(before, snapshot(m.term)), []);
  m.dispose();
});

// ---------------------------------------------------------------------------
// Mode-append scanner (Q4 gap fix) — serialize omits ?1006h and ?25; the mirror
// tracks DECSET/DECRST and re-emits them.
// ---------------------------------------------------------------------------

test('mode-append: enabled SGR mouse encoding (?1006h) is re-emitted', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  await m.feed('\x1b[?1006h');
  await m.afterWrite();
  assert.equal(m.modes().sgr, true, 'modes().sgr should be true after ?1006h');
  assert.match(m.serialize(), /\x1b\[\?1006h/, 'serialized frame must contain ?1006h');
  m.dispose();
});

test('mode-append: hidden cursor (?25l) is re-emitted', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  await m.feed('some output\x1b[?25l');
  await m.afterWrite();
  assert.match(m.serialize(), /\x1b\[\?25l/, 'serialized frame must contain ?25l when cursor hidden');
  m.dispose();
});

test('mode-append: visible cursor does NOT emit ?25l', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  await m.feed('some output\x1b[?25l\x1b[?25h'); // hide then show
  await m.afterWrite();
  assert.doesNotMatch(m.serialize(), /\x1b\[\?25l/, 'visible cursor must not re-emit ?25l');
  m.dispose();
});

test('modes(): appMouse reflects DECSET 1000/1002/1003', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  assert.equal(m.modes().appMouse, false);
  await m.feed('\x1b[?1002h');
  await m.afterWrite();
  assert.equal(m.modes().appMouse, true, 'appMouse true after ?1002h');
  await m.feed('\x1b[?1002l');
  await m.afterWrite();
  assert.equal(m.modes().appMouse, false, 'appMouse false after ?1002l');
  m.dispose();
});

test('bufferType(): reports alternate inside alt screen, normal after exit', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  await m.feed('normal\r\n');
  await m.afterWrite();
  assert.equal(m.bufferType(), 'normal');
  await m.feed('\x1b[?1049h');
  await m.afterWrite();
  assert.equal(m.bufferType(), 'alternate', 'alt after ?1049h');
  await m.feed('\x1b[?1049l');
  await m.afterWrite();
  assert.equal(m.bufferType(), 'normal', 'normal after ?1049l');
  m.dispose();
});

// ---------------------------------------------------------------------------
// Dirty-target reconcile (Q5) — phase-2 gate. Serialize restores into a FRESH
// terminal; a reconnecting client is dirty, so the reconcile prefix's clears
// are still required. This documents/locks the truth table.
// ---------------------------------------------------------------------------

const RECONCILE_PREFIX = '\x1b[?1049l\x1b[2J\x1b[3J\x1b[H';

test('dirty-target: frame alone leaves stale scrollback on a dirty normal client', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  for (let i = 0; i < 15; i++) await m.feed(`real line ${i}\r\n`);
  await m.feed('prompt> ');
  await m.afterWrite();
  const frame = m.serialize();

  const dirty = freshTerm();
  for (let i = 0; i < 25; i++) await write(dirty, `STALE ${i}\r\n`);
  await write(dirty, frame); // no prefix
  const withoutPrefix = diff(snapshot(m.term), snapshot(dirty));
  assert.notDeepEqual(withoutPrefix, [], 'frame WITHOUT prefix should NOT match a dirty client (stale rows survive)');

  const clean = freshTerm();
  for (let i = 0; i < 25; i++) await write(clean, `STALE ${i}\r\n`);
  await write(clean, RECONCILE_PREFIX + frame); // with prefix
  const withPrefix = diff(snapshot(m.term), snapshot(clean));
  assert.deepEqual(withPrefix, [], `prefix+frame must reconcile a dirty client:\n${withPrefix.join('\n')}`);

  m.dispose();
  dirty.dispose();
  clean.dispose();
});

test('dirty-target: prefix rescues a client stuck in the alt buffer', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  await m.feed('normal content line\r\nprompt> ');
  await m.afterWrite();
  const frame = m.serialize();

  const dirtyAlt = freshTerm();
  await write(dirtyAlt, '\x1b[?1049h\x1b[2J\x1b[HALT-SCREEN-JUNK');
  await write(dirtyAlt, RECONCILE_PREFIX + frame);
  const d = diff(snapshot(m.term), snapshot(dirtyAlt));
  assert.deepEqual(d, [], `prefix must force a stuck-alt client back to normal:\n${d.join('\n')}`);

  m.dispose();
  dirtyAlt.dispose();
});

// ---------------------------------------------------------------------------
// Cross-version leg (serialize on headless 6.0.0 → replay into 5.5.0, the client
// core). Guarded-skip: the 5.5.0 dep can't be installed via npm alias in this
// env (see task #6 / memory argus-npm-install-env-gotchas). Auto-activates once
// a `headless55` module resolves.
// ---------------------------------------------------------------------------
// Screen-only frames — the payload behind a non-destructive mid-life resync.
// A full serialize() re-emits history, which forces the client frame to open
// with ED 3 (wiping the client's own scrollback). serializeScreen() carries the
// visible screen alone, so the frame can realign without that erase.
// ---------------------------------------------------------------------------

test('serializeScreen carries the visible screen without the scrollback history', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  const filler = Array.from({ length: 28 }, (_, i) => `filler${i}`).join('\r\n');
  await m.feed(`OLDEST\r\n${filler}\r\nNEWEST`);
  await m.afterWrite();

  assert.match(m.serialize(), /OLDEST/, 'full frame must still carry scrolled-off history');
  const screen = m.serializeScreen();
  assert.doesNotMatch(screen, /OLDEST/, 'screen-only frame must omit scrolled-off history');
  assert.match(screen, /NEWEST/, 'screen-only frame must carry the current screen');
  m.dispose();
});

test('serializeScreen re-emits the modes serialize() omits', async () => {
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  await m.feed('\x1b[?1006h\x1b[?25lhidden');
  await m.afterWrite();

  const screen = m.serializeScreen();
  assert.match(screen, /\x1b\[\?1006h/, 'SGR mouse encoding must survive a screen-only frame');
  assert.match(screen, /\x1b\[\?25l/, 'hidden cursor must survive a screen-only frame');
  m.dispose();
});

// ---------------------------------------------------------------------------

test('cross-version: serialize 6.0.0 → replay 5.5.0 holds grid', async (t) => {
  let Terminal55: (new (opts?: ITerminalOptions & ITerminalInitOnlyOptions) => XTerminal) | null = null;
  try {
    const mod = (await import('headless55')) as unknown as {
      Terminal: new (opts?: ITerminalOptions & ITerminalInitOnlyOptions) => XTerminal;
    };
    Terminal55 = mod.Terminal;
  } catch {
    t.skip('headless55 (5.5.0) dep unresolved — see task #6; cross-version guard inactive');
    return;
  }
  const m = new TerminalMirror(COLS, ROWS, SCROLLBACK);
  const long = Array.from({ length: COLS * 3 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
  await m.feed(`${long}\r\n汉字テスト\r\n\x1b[38;5;208mcolor\x1b[0m\r\n`);
  await m.afterWrite();
  const frame = m.serialize();
  const dst = new Terminal55!({ cols: COLS, rows: ROWS, scrollback: SCROLLBACK, allowProposedApi: true });
  await write(dst, frame);
  const d = diff(snapshot(m.term), snapshot(dst));
  assert.deepEqual(d, [], `6.0.0→5.5.0 diffs:\n${d.join('\n')}`);
  m.dispose();
  dst.dispose();
});
