import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameToRows, makeSnippet, searchRows, SNIPPET_MAX } from './scrollbackSearch.js';
import { TerminalMirror } from '../TerminalMirror.js';

test('searchRows joins soft-wrapped rows, so a match split across a wrap is found once, at its first row', () => {
  const rows = [
    { text: 'unrelated' },
    { text: 'the build fai' },
    { text: 'led on step 3', wrapped: true },
    { text: 'next line' },
  ];
  const hits = searchRows(rows, 'build failed', 10);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.line, 1);
  assert.equal(hits[0]!.snippet, 'the build failed on step 3');
  assert.equal(hits[0]!.snippet.slice(hits[0]!.matchStart, hits[0]!.matchStart + hits[0]!.matchLength), 'build failed');
});

test('searchRows is case-insensitive and literal (regex metacharacters match themselves)', () => {
  const rows = [{ text: 'ERROR: Cannot find module' }, { text: 'a.b*c' }, { text: 'axbbc' }];
  assert.deepEqual(searchRows(rows, 'cannot FIND', 10).map((h) => h.line), [0]);
  assert.deepEqual(searchRows(rows, 'a.b*c', 10).map((h) => h.line), [1]);
});

test('searchRows returns newest first and stops at the cap', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ text: `match ${i}` }));
  const hits = searchRows(rows, 'match', 5);
  assert.deepEqual(hits.map((h) => h.line), [49, 48, 47, 46, 45]);
  assert.deepEqual(searchRows(rows, 'match', 0), []);
  assert.deepEqual(searchRows(rows, '', 5), []);
});

test('makeSnippet caps the length, collapses whitespace and marks the cuts', () => {
  const text = 'a'.repeat(500) + '  NEEDLE\t\there ' + 'b'.repeat(500);
  const s = makeSnippet(text, 502, 6);
  assert.ok(s.snippet.length <= SNIPPET_MAX + 2);
  assert.equal(s.snippet.slice(s.matchStart, s.matchStart + s.matchLength), 'NEEDLE');
  assert.ok(s.snippet.startsWith('…') && s.snippet.endsWith('…'));
  assert.ok(!/\s{2}/.test(s.snippet));
});

test('frameToRows recovers logical lines from a real hibernated frame, wrapped lines joined', async () => {
  const mirror = new TerminalMirror(20, 5, 1000);
  await mirror.feed('\x1b[31mfirst\x1b[0m line\r\n' + 'w'.repeat(15) + ' wrapped tail here\r\n' + 'gap\x1b[5Cafter\r\n> ');
  assert.equal(mirror.hibernate(), true);
  const frame = mirror.frozenFrame();
  assert.ok(frame);
  const texts = frameToRows(frame).map((r) => r.text.trimEnd());
  assert.ok(texts.includes('first line'));
  assert.ok(texts.includes('w'.repeat(15) + ' wrapped tail here'), JSON.stringify(texts));
  assert.equal(searchRows(frameToRows(frame), 'WRAPPED TAIL', 5).length, 1);
  // Reading the frame (and the rows accessor) did not wake the mirror.
  assert.equal(mirror.searchableRows(), null);
  assert.equal(mirror.hibernated, true);
  mirror.dispose();
});

test('TerminalMirror.searchableRows exposes the wrap flag and keeps the space at a wrap point', async () => {
  const mirror = new TerminalMirror(10, 5, 100);
  await mirror.feed('hello you there\r\nnext');
  const rows = mirror.searchableRows()!;
  assert.deepEqual(searchRows(rows, 'you there', 5).map((h) => h.snippet), ['hello you there']);
  assert.equal(rows[1]!.wrapped, true);
  mirror.dispose();
});
