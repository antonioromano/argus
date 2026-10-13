import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerminalMirror } from './TerminalMirror.js';

/** Long, styled, wrapping history well past one screen, plus the modes replay must keep. */
function history(lines: number): string {
  let s = '';
  for (let i = 0; i < lines; i++) s += `\x1b[3${i % 8}mline ${i} ` + 'x'.repeat(i % 130) + '\x1b[0m\r\n';
  return s + '\x1b[?1000h\x1b[?1006h\x1b[?2004h\x1b[?25l> prompt\x1b[5;10H';
}

/** A redraw-heavy tail: in-place line rewrites, cursor jumps, overwrites, scrolling. */
const LATER =
  '\r\x1b[2Kredraw\x1b[3A\x1b[1;31mOVER\x1b[0m\r\n'.repeat(6) + 'y'.repeat(500) + '\x1b[H\x1b[2Kheader\x1b[24;1Hfooter';

async function twins(cols: number, rows: number, scrollback: number, content: string) {
  const live = new TerminalMirror(cols, rows, scrollback);
  const slept = new TerminalMirror(cols, rows, scrollback);
  await live.feed(content);
  await slept.feed(content);
  return { live, slept };
}

function sameBuffer(a: TerminalMirror, b: TerminalMirror): void {
  assert.equal(b.totalRows(), a.totalRows(), 'row count (scrollback depth) preserved');
  assert.deepEqual(b.readRows(0, b.totalRows()), a.readRows(0, a.totalRows()), 'every row preserved');
  const ca = a.term.buffer.active;
  const cb = b.term.buffer.active;
  assert.deepEqual([cb.cursorX, cb.cursorY], [ca.cursorX, ca.cursorY], 'cursor preserved');
  assert.equal(b.serialize(), a.serialize(), 'frames identical');
  assert.deepEqual(b.modes(), a.modes());
}

test('a hibernated mirror serves its frames, wakes identical, and tracks later output identically', async () => {
  const { live, slept } = await twins(80, 24, 5000, history(400));
  const frame = slept.serialize();
  const screen = slept.serializeScreen();

  assert.equal(slept.hibernate(), true);
  assert.equal(slept.hibernated, true);
  assert.equal(slept.serialize(), frame, 'joins are answered from the frozen frame');
  assert.equal(slept.serializeScreen(), screen);
  assert.equal(slept.bufferType(), 'normal');
  assert.equal(slept.hibernated, true, 'serving frames does not wake it');

  // Output wakes it; from here on the two must never diverge.
  await live.feed(LATER);
  await slept.feed(LATER);
  assert.equal(slept.hibernated, false);
  sameBuffer(live, slept);
  live.dispose();
  slept.dispose();
});

test('wake is synchronous: a read straight after sees the whole buffer', async () => {
  const { live, slept } = await twins(80, 24, 5000, history(200));
  slept.hibernate();
  // totalRows is what a width change records as the dedup boundary, synchronously.
  assert.equal(slept.totalRows(), live.totalRows());
  assert.deepEqual(slept.readRows(0, 5), live.readRows(0, 5));
  live.dispose();
  slept.dispose();
});

test('a saturated scrollback comes back saturated — hibernating never costs history', async () => {
  const { live, slept } = await twins(60, 20, 300, history(700));
  assert.equal(live.scrollbackFull(), true);
  slept.hibernate();
  assert.equal(slept.scrollbackFull(), true);
  sameBuffer(live, slept);
  live.dispose();
  slept.dispose();
});

test('a resize while asleep reflows exactly like a mirror that never slept', async () => {
  const { live, slept } = await twins(100, 24, 5000, history(150));
  slept.hibernate();
  live.resize(70, 30);
  slept.resize(70, 30);
  await live.feed(LATER);
  await slept.feed(LATER);
  sameBuffer(live, slept);
  live.dispose();
  slept.dispose();
});

test('CSI handlers registered through the mirror survive a wake', async () => {
  const m = new TerminalMirror(40, 10, 100);
  let hits = 0;
  m.registerCsiHandler({ intermediates: ' ', final: 'q' }, () => {
    hits++;
    return false;
  });
  await m.feed('hello');
  assert.equal(m.hibernate(), true);
  await m.feed('\x1b[2 q');
  assert.equal(hits, 1, 'the DECSCUSR hook fires on the rebuilt emulator');
  m.dispose();
});

test('refuses to hibernate what it could not rebuild faithfully', async () => {
  const alt = new TerminalMirror(40, 10, 100);
  await alt.feed('\x1b[?1049hfull-screen app');
  assert.equal(alt.hibernate(), false, 'alternate screen');

  const region = new TerminalMirror(40, 10, 100);
  await region.feed('\x1b[2;8r');
  assert.equal(region.hibernate(), false, 'scroll region (serialize does not restore it)');
  await region.feed('\x1b[r');
  assert.equal(region.hibernate(), true, 'region reset → eligible again');

  const busy = new TerminalMirror(40, 10, 100);
  void busy.feed('x'.repeat(100_000));
  assert.equal(busy.hibernate(), false, 'unparsed bytes pending');
  await busy.afterWrite();

  for (const m of [alt, region, busy]) m.dispose();
});

test('disposing a hibernated mirror is clean and late readers do not crash', async () => {
  const m = new TerminalMirror(40, 10, 100);
  await m.feed('bye');
  m.hibernate();
  m.dispose();
  assert.equal(m.serialize(), '');
  assert.deepEqual(m.readRows(0, 10), []);
  assert.ok(m.term, 'a late StateDetector read gets an inert terminal');
  await m.feed('ignored');
  assert.equal(m.hibernated, false);
});
