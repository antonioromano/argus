import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerminalMirror } from './TerminalMirror.js';

const COLS = 40;
const ROWS = 10;

/** Every row the mirror holds, scrollback first, screen last. */
function allRows(mirror: TerminalMirror): string[] {
  const buf = mirror.term.buffer.active;
  const out: string[] = [];
  for (let i = 0; i < buf.baseY + mirror.term.rows; i++) {
    out.push(buf.getLine(i)?.translateToString(true) ?? '');
  }
  return out;
}

/** 30 numbered rows: 20 of scrollback, 10 on screen. */
async function seeded(): Promise<TerminalMirror> {
  const mirror = new TerminalMirror(COLS, ROWS, 200);
  await mirror.feed(Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\r\n'));
  await mirror.afterWrite();
  return mirror;
}

test('rebuildWithout drops the given rows and keeps every other one', async () => {
  const mirror = await seeded();

  await mirror.rebuildWithout(5, 10);

  const rows = allRows(mirror).filter((r) => r.length > 0);
  assert.ok(rows.includes('line-4'), 'the row before the range survives');
  assert.ok(rows.includes('line-10'), 'the row after the range survives');
  for (const gone of ['line-5', 'line-6', 'line-7', 'line-8', 'line-9']) {
    assert.ok(!rows.includes(gone), `${gone} should have been removed`);
  }
  mirror.dispose();
});

test('rebuildWithout leaves the visible screen byte-identical', async () => {
  const mirror = await seeded();
  const before = mirror.serializeScreen();

  await mirror.rebuildWithout(5, 10);

  assert.equal(mirror.serializeScreen(), before);
  mirror.dispose();
});

test('rebuildWithout preserves the colour of a retained scrollback row', async () => {
  const mirror = new TerminalMirror(COLS, ROWS, 200);
  await mirror.feed('\x1b[31mred-row\x1b[0m\r\n');
  await mirror.feed(Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\r\n'));
  await mirror.afterWrite();

  await mirror.rebuildWithout(10, 15);

  const buf = mirror.term.buffer.active;
  let found: number | undefined;
  for (let y = 0; y < buf.baseY + mirror.term.rows; y++) {
    if (buf.getLine(y)?.translateToString(true) === 'red-row') found = y;
  }
  assert.ok(found !== undefined, 'the coloured row should still be there');
  const cell = buf.getLine(found)?.getCell(0);
  assert.equal(cell?.getFgColor(), 1, 'red (ANSI 1) should have survived the rebuild');
  assert.equal(cell?.isFgPalette(), true);
  mirror.dispose();
});

test('rebuildWithout ignores a range that is not inside the scrollback', async () => {
  const mirror = await seeded();
  const before = allRows(mirror);

  await mirror.rebuildWithout(5, 5);
  assert.deepEqual(allRows(mirror), before, 'an empty range changes nothing');

  await mirror.rebuildWithout(-3, 2);
  assert.deepEqual(allRows(mirror), before, 'a negative start changes nothing');
  mirror.dispose();
});
