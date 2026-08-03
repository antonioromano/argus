import { describe, it, expect } from 'vitest';
import { findLinks, type LinkBuffer, type LinkRow } from './terminalLinks.js';

type Row = string | (Partial<LinkRow> & { text: string });

const buffer = (rows: Row[]): LinkBuffer => ({
  row: (y: number) => {
    const row = rows[y];
    if (row === undefined) return undefined;
    return typeof row === 'string' ? { text: row, isWrapped: false } : { isWrapped: false, ...row };
  },
});

/** Text of every link covering row `y`. */
const texts = (rows: Row[], y: number): string[] => findLinks(buffer(rows), y).map((l) => l.text);

describe('findLinks', () => {
  it('finds a URL that fits on one row', () => {
    const rows = ['  Ship it: https://github.com/rbly/argus/pull/9 today', '  and then tell me'];
    expect(texts(rows, 0)).toEqual(['https://github.com/rbly/argus/pull/9']);
  });

  it('reports no link on a row without one', () => {
    expect(texts(['  nothing to see here'], 0)).toEqual([]);
  });

  it('ranges the link at the cells it occupies', () => {
    const [link] = findLinks(buffer(['ab https://example.com/x']), 0);
    expect(link).toMatchObject({ startY: 0, startX: 3, endY: 0, endX: 23 });
  });

  // ── the agent's own line breaks ────────────────────────────────────────────

  // A row filled to the wrap width, with the URL cut mid-token — the shape every
  // Ink TUI produces for a URL longer than the room left on the line.
  const splitUrl = [
    '  The fix — https://github.com/rbly/rebrandly-otel',
    '  -python-layer/pull/17',
    '  8 files, +290/-28',
  ];
  const whole = 'https://github.com/rbly/rebrandly-otel-python-layer/pull/17';

  it('rejoins a URL the agent split across two rows', () => {
    expect(texts(splitUrl, 0)).toEqual([whole]);
  });

  it('finds the same URL from the row holding its tail', () => {
    expect(texts(splitUrl, 1)).toEqual([whole]);
  });

  it('spans the range across both rows', () => {
    const [link] = findLinks(buffer(splitUrl), 1);
    expect(link).toMatchObject({ startY: 0, startX: 12, endY: 1, endX: 22 });
  });

  it('rejoins a URL split over three rows', () => {
    const rows = [
      '  see https://github.com/rbly-internal/rebrandly',
      '  -otel-python-layer-and-friends/pull/17/files#d',
      '  iff-0 for the change',
    ];
    const url = 'https://github.com/rbly-internal/rebrandly-otel-python-layer-and-friends/pull/17/files#diff-0';
    expect(texts(rows, 0)).toEqual([url]);
    expect(texts(rows, 1)).toEqual([url]);
    expect(texts(rows, 2)).toEqual([url]);
  });

  it('does not report a link from rows the URL never reached', () => {
    expect(texts(splitUrl, 2)).toEqual([]);
  });

  it('leaves the URL alone when the row it ends on had room to spare', () => {
    // Nothing forced this break, so the row below is a new line the agent wrote.
    const rows = [
      '  merged https://github.com/rbly/argus/pull/9',
      '  -1 is a different pull request entirely, ignore',
    ];
    expect(texts(rows, 0)).toEqual(['https://github.com/rbly/argus/pull/9']);
  });

  it('keeps a word-wrapped sentence out of the URL', () => {
    // The row is full, so it did continue — but at a space, and a space ends a URL.
    const rows = [
      '  Opened https://github.com/rbly/argus/pull/9 and',
      '  asked Marco to take a look at the diff tomorrow',
    ];
    expect(texts(rows, 0)).toEqual(['https://github.com/rbly/argus/pull/9']);
  });

  // The first row of an agent message carries the gutter glyph where every other
  // row of that message carries indent, so the row under it is not indented
  // relative to it — they line up. Read raw, that looked like authored structure
  // and left the first link of a list broken while the rest joined.
  const list = [
    '⏺ - https://github.com/rbly-internal/api-product/',
    '  pull/161',
    '  - https://github.com/rbly-internal/api-product/',
    '  pull/160',
    '  - https://github.com/rbly-internal/api-product/',
    '  pull/159',
  ];

  it('rejoins the URL on the row the gutter glyph opens', () => {
    const url = 'https://github.com/rbly-internal/api-product/pull/161';
    expect(texts(list, 0)).toEqual([url]);
    expect(texts(list, 1)).toEqual([url]);
  });

  it('rejoins the rest of the list the same way', () => {
    expect(texts(list, 2)).toEqual(['https://github.com/rbly-internal/api-product/pull/160']);
    expect(texts(list, 3)).toEqual(['https://github.com/rbly-internal/api-product/pull/160']);
    expect(texts(list, 4)).toEqual(['https://github.com/rbly-internal/api-product/pull/159']);
    expect(texts(list, 5)).toEqual(['https://github.com/rbly-internal/api-product/pull/159']);
  });

  it('stops each list item at its own row', () => {
    // The row below a finished item opens a new bullet, so nothing runs on.
    expect(findLinks(buffer(list), 1)[0]).toMatchObject({ startY: 0, endY: 1 });
  });

  it('does not fold a row that opens a new block into the URL above it', () => {
    const rows = [
      '  The fix — https://github.com/rbly/rebrandly-otel',
      '  - python-layer/pull/17',
    ];
    expect(texts(rows, 0)).toEqual(['https://github.com/rbly/rebrandly-otel']);
  });

  it('does not fold a row whose indent changed', () => {
    const rows = [
      '  The fix — https://github.com/rbly/rebrandly-otel',
      '      python-layer/pull/17',
    ];
    expect(texts(rows, 0)).toEqual(['https://github.com/rbly/rebrandly-otel']);
  });

  it('joins nothing when the rows are too short to tell a wrap from a line', () => {
    const rows = ['  https://a.io/x', '  y/z'];
    expect(texts(rows, 0)).toEqual(['https://a.io/x']);
  });

  it('drops the sentence punctuation after a URL', () => {
    expect(texts(['  Landed in https://example.com/a-b.'], 0)).toEqual(['https://example.com/a-b']);
  });

  it('finds every URL on the row', () => {
    const rows = ['  https://a.example.com/one https://b.example.com/two'];
    expect(texts(rows, 0)).toEqual(['https://a.example.com/one', 'https://b.example.com/two']);
  });

  // ── the emulator's own wrap ────────────────────────────────────────────────

  it('still joins rows the emulator wrapped itself', () => {
    // No geometry to go on — short rows — but isWrapped says these are one line.
    const rows: Row[] = [
      { text: 'https://example.com/a' },
      { text: 'bcdef/gh', isWrapped: true },
    ];
    expect(texts(rows, 0)).toEqual(['https://example.com/abcdef/gh']);
    expect(texts(rows, 1)).toEqual(['https://example.com/abcdef/gh']);
  });

  // ── cell geometry ─────────────────────────────────────────────────────────

  it('ranges past a wide character by cells, not by code units', () => {
    // '日本' occupies two cells each, so the URL starts at column 6, not 4.
    const text = '日本 https://example.com/x';
    const columns = () => [0, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    const [link] = findLinks(buffer([{ text, columns }]), 0);
    expect(link).toMatchObject({ startX: 5, endX: 25 });
    expect(link.text).toBe('https://example.com/x');
  });

  // ── guards ────────────────────────────────────────────────────────────────

  it('ignores a URL whose host is not the one it reads as', () => {
    // U+3002 in the host normalises to '.', so this text is not where it goes.
    expect(texts(['  https://example。com/x'], 0)).toEqual([]);
  });
});
