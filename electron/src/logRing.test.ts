import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogRing, installConsoleCapture, readTail } from './logRing.js';

const fixed = () => new Date('2026-10-29T12:00:00.000Z');

test('the ring keeps the newest lines up to its cap', () => {
  const ring = createLogRing(3, fixed);
  for (let i = 1; i <= 5; i++) ring.push('warn', [`line ${i}`]);
  assert.deepEqual(ring.tail(), [
    '2026-10-29T12:00:00.000Z warn line 3',
    '2026-10-29T12:00:00.000Z warn line 4',
    '2026-10-29T12:00:00.000Z warn line 5',
  ]);
  assert.deepEqual(ring.tail(1), ['2026-10-29T12:00:00.000Z warn line 5']);
  assert.deepEqual(ring.tail(0), []);
});

test('entries are formatted, flattened to one line and truncated', () => {
  const ring = createLogRing(5, fixed);
  ring.push('error', ['failed %s:', 'x', new Error('boom')]);
  const [line] = ring.tail();
  assert.ok(line.startsWith('2026-10-29T12:00:00.000Z error failed x: Error: boom'), line);
  assert.ok(!line.includes('\n'));
  ring.push('warn', ['y'.repeat(2000)]);
  assert.ok(ring.tail(1)[0].length < 600);
});

test('the console capture tees into the ring and still calls the original', () => {
  const calls: unknown[][] = [];
  const con = { warn: (...a: unknown[]) => { calls.push(['warn', ...a]); }, error: (...a: unknown[]) => { calls.push(['error', ...a]); } };
  const ring = createLogRing(5, fixed);
  const uninstall = installConsoleCapture(ring, con as unknown as Console);
  con.warn('careful', 1);
  con.error('bad');
  assert.deepEqual(calls, [['warn', 'careful', 1], ['error', 'bad']]);
  assert.equal(ring.tail().length, 2);
  uninstall();
  con.warn('after');
  assert.equal(ring.tail().length, 2);
});

test('readTail returns [] for a missing file and the last lines of a big one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logring-'));
  try {
    assert.deepEqual(readTail(join(dir, 'nope.log'), 10), []);
    const file = join(dir, 'update.log');
    const lines = Array.from({ length: 20000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`);
    writeFileSync(file, `${lines.join('\n')}\n`);
    const tail = readTail(file, 3);
    assert.deepEqual(tail, lines.slice(-3));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
