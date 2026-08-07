import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRows, findStaleRowRange } from './scrollbackDedup.js';

/** Hard-wrap text into rows of `width`, the way an agent printing to a pty does. */
const hardWrap = (text: string, width: number): string[] => {
  const rows: string[] = [];
  for (let i = 0; i < text.length; i += width) rows.push(text.slice(i, i + width));
  return rows;
};

const LOREM =
  'Policy docs built and diffed. Additive only: 12 to 13 statements, every existing ' +
  'statement byte-identical, 5057 bytes (inline limit 10240). Left alone: CHANGELOG ' +
  'entries and docs/MULTI_RUNTIME.md:21 are accurate history about the old runner.';

test('normalizeRows strips the wrap, so the same text at two widths compares equal', () => {
  assert.equal(normalizeRows(hardWrap(LOREM, 160)), normalizeRows(hardWrap(LOREM, 60)));
});

test('normalizeRows drops trailing cell padding xterm reports on short rows', () => {
  assert.equal(normalizeRows(['abc   ', 'def      ']), 'abcdef');
});

test('normalizeRows ignores blank rows, which carry no wrap-independent content', () => {
  assert.equal(normalizeRows(['abc', '', '   ', 'def']), 'abcdef');
});

test('a reprint of the whole history flags every history row', () => {
  const oldRows = hardWrap(LOREM, 160);
  const newRows = hardWrap(LOREM, 60);

  const range = findStaleRowRange(oldRows, newRows, 100);

  assert.deepEqual(range, { start: 0, end: oldRows.length });
});

test('a reprint of only the tail leaves the older rows alone', () => {
  const head = 'Rows from earlier in the session that the agent never reprinted. ';
  const oldRows = [...hardWrap(head, 40), ...hardWrap(LOREM, 160)];
  const newRows = hardWrap(LOREM, 60);

  const range = findStaleRowRange(oldRows, newRows, 100);

  assert.ok(range, 'the reprinted tail should be found');
  assert.equal(range.end, oldRows.length);
  assert.equal(
    normalizeRows(oldRows.slice(range.start, range.end)),
    normalizeRows(hardWrap(LOREM, 160)),
    'exactly the reprinted text should be flagged',
  );
});

test('unrelated new output flags nothing', () => {
  const range = findStaleRowRange(hardWrap(LOREM, 160), hardWrap('totally different output here', 40), 100);

  assert.equal(range, undefined);
});

test('an overlap shorter than the threshold flags nothing', () => {
  // The tail of history reappears, but only a few characters of it.
  const range = findStaleRowRange(['aaaa', 'done'], ['done', 'and then new work'], 100);

  assert.equal(range, undefined);
});

test('a row only partly covered by the overlap is kept, not deleted', () => {
  // 'keep-me' shares its row with reprinted text, so that row holds content the
  // reprint does not carry. Deleting it would lose history.
  const oldRows = ['keep-me' + 'REPRINTED-'.repeat(20)];
  const newRows = hardWrap('REPRINTED-'.repeat(20), 30);

  const range = findStaleRowRange(oldRows, newRows, 100);

  assert.equal(range, undefined);
});

test('the empty history of a fresh session flags nothing', () => {
  assert.equal(findStaleRowRange([], hardWrap(LOREM, 60), 100), undefined);
});
