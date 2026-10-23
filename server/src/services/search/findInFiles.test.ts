import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRgArgs, parseGlobList, toMatch, type FindInFilesOptions } from './findInFiles.js';

const base: FindInFilesOptions = { query: 'foo', regex: false, caseSensitive: false, wholeWord: false, include: [], exclude: [] };

test('parseGlobList splits on commas outside braces', () => {
  assert.deepEqual(parseGlobList('*.ts, src/**/*.{ts,tsx} ,,docs'), ['*.ts', 'src/**/*.{ts,tsx}', 'docs']);
  assert.deepEqual(parseGlobList(undefined), []);
  assert.deepEqual(parseGlobList(''), []);
});

test('parseGlobList rejects non-strings, control chars, and oversize lists', () => {
  assert.equal(parseGlobList(['a', 'b']), null);
  assert.equal(parseGlobList('a\nb'), null);
  assert.equal(parseGlobList('x'.repeat(300)), null);
  assert.equal(parseGlobList(Array.from({ length: 40 }, (_, i) => `g${i}`).join(',')), null);
});

test('buildRgArgs binds the query to -e and ends options before the path', () => {
  const args = buildRgArgs({ ...base, query: '--pre=evil' });
  const e = args.indexOf('-e');
  assert.equal(args[e + 1], '--pre=evil');
  assert.deepEqual(args.slice(-2), ['--', '.']);
  assert.ok(args.includes('--no-config'));
  assert.ok(args.includes('--fixed-strings'));
  assert.ok(args.includes('--ignore-case'));
});

test('buildRgArgs maps the options to rg flags', () => {
  const args = buildRgArgs({ ...base, regex: true, caseSensitive: true, wholeWord: true });
  assert.ok(!args.includes('--fixed-strings'));
  assert.ok(args.includes('--case-sensitive'));
  assert.ok(args.includes('--word-regexp'));
});

test('buildRgArgs keeps globs glued to --glob= and puts mandatory exclusions last', () => {
  const args = buildRgArgs({ ...base, include: ['-x', 'node_modules/**'], exclude: ['!dist', 'docs'] });
  assert.ok(args.includes('--glob=-x'));
  assert.ok(args.includes('--glob=!dist'));
  assert.ok(args.includes('--glob=!docs'));
  const userInclude = args.indexOf('--glob=node_modules/**');
  const mandatory = args.indexOf('--glob=!**/node_modules/**');
  assert.ok(userInclude >= 0 && mandatory > userInclude, 'the later glob must be the exclusion');
  assert.ok(args.includes('--iglob=!*.map'));
  assert.ok(args.includes('--iglob=!*.png'));
});

test('toMatch converts byte offsets to UTF-16 offsets and trims indentation', () => {
  // "é" is 2 bytes in UTF-8; "foo" starts at byte 9, char 8 (after 2 spaces of indent).
  const m = toMatch('  héllo foo\n', 3, [{ start: 9, end: 12 }]);
  assert.equal(m.line, 3);
  assert.equal(m.column, 9);
  assert.equal(m.preview, 'héllo foo');
  assert.deepEqual(m.ranges, [[6, 9]]);
  assert.equal(m.preview.slice(6, 9), 'foo');
});

test('toMatch windows a long line around the first match', () => {
  const line = 'a'.repeat(1000) + 'needle' + 'b'.repeat(1000);
  const m = toMatch(line, 1, [{ start: 1000, end: 1006 }]);
  assert.ok(m.preview.length <= 240);
  const [[a, b]] = m.ranges;
  assert.equal(m.preview.slice(a, b), 'needle');
  assert.equal(m.column, 1001);
});

test('toMatch maps several multibyte-offset submatches in one pass', () => {
  // "€" is 3 bytes: byte offsets 0/3 and 6/9 wrap the two "€" characters' neighbours.
  const m = toMatch('a€b€c', 1, [{ start: 1, end: 4 }, { start: 5, end: 8 }]);
  assert.deepEqual(m.ranges, [[1, 2], [3, 4]]);
  assert.equal(m.preview.slice(1, 2), '€');
  assert.equal(m.preview.slice(3, 4), '€');
});
