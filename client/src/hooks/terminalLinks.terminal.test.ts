/**
 * The other half of terminalLinks: reading rows out of a real xterm buffer.
 * `findLinks` is exercised against a fake buffer in terminalLinks.test.ts — this
 * drives an actual Terminal so the cell walk (wide characters, trailing padding,
 * the emulator's own wrap) is checked against the emulator rather than a model.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Terminal } from '@xterm/xterm';
import type { ILink } from '@xterm/xterm';
import { createTerminalLinkProvider } from './terminalLinks.js';

let terminal: Terminal | undefined;

afterEach(() => {
  terminal?.dispose();
  terminal = undefined;
});

/** A terminal holding `rows`, each ended the way an agent CLI ends them. */
async function withRows(rows: string[], cols = 50): Promise<Terminal> {
  terminal = new Terminal({ cols, rows: 24, allowProposedApi: true });
  await new Promise<void>((resolve) => terminal!.write(rows.join('\r\n'), resolve));
  return terminal;
}

function linksOn(term: Terminal, row: number): ILink[] {
  const provider = createTerminalLinkProvider(term, () => {});
  let links: ILink[] | undefined;
  provider.provideLinks(row + 1, (result) => {
    links = result;
  });
  return links ?? [];
}

describe('createTerminalLinkProvider', () => {
  it('rejoins a URL split down a table cell', async () => {
    const term = await withRows(
      [
        '│ #8 (https://github.com/rbly-internal/rb-abuse- │ 1 │',
        '│ email-slack/pull/8)                            │ 2 │',
      ],
      54,
    );
    const expected = 'https://github.com/rbly-internal/rb-abuse-email-slack/pull/8';
    expect(linksOn(term, 0).map((l) => l.text)).toEqual([expected]);
    expect(linksOn(term, 1).map((l) => l.text)).toEqual([expected]);
  });

  it('rejoins a URL the agent split across two rows', async () => {
    const term = await withRows([
      '  The fix — https://github.com/rbly/rebrandly-otel',
      '  -python-layer/pull/17',
      '  8 files, +290/-28',
    ]);
    const expected = 'https://github.com/rbly/rebrandly-otel-python-layer/pull/17';
    expect(linksOn(term, 0).map((l) => l.text)).toEqual([expected]);
    expect(linksOn(term, 1).map((l) => l.text)).toEqual([expected]);
  });

  it('ranges the link over both rows, 1-based and inclusive', async () => {
    const term = await withRows([
      '  The fix — https://github.com/rbly/rebrandly-otel',
      '  -python-layer/pull/17',
      '  8 files, +290/-28',
    ]);
    expect(linksOn(term, 1)[0].range).toEqual({ start: { x: 13, y: 1 }, end: { x: 23, y: 2 } });
  });

  it('opens the whole URL when either half is clicked', async () => {
    const term = await withRows([
      '  The fix — https://github.com/rbly/rebrandly-otel',
      '  -python-layer/pull/17',
      '  8 files, +290/-28',
    ]);
    const opened: string[] = [];
    const provider = createTerminalLinkProvider(term, (uri) => opened.push(uri));
    for (const row of [1, 2]) {
      provider.provideLinks(row, (links) => {
        links?.[0].activate(new MouseEvent('click'), links[0].text);
      });
    }
    expect(opened).toEqual([
      'https://github.com/rbly/rebrandly-otel-python-layer/pull/17',
      'https://github.com/rbly/rebrandly-otel-python-layer/pull/17',
    ]);
  });

  it('places the range past wide characters by cell, not by character', async () => {
    // '日本' takes two cells each, so the URL starts at cell 5 — 1-based 6, not
    // the 4 a character count would give.
    const term = await withRows(['日本 https://example.com/x']);
    expect(linksOn(term, 0)[0].range.start).toEqual({ x: 6, y: 1 });
  });

  it('joins a URL the emulator itself wrapped past the right margin', async () => {
    // No agent involved: one long write with no newline, wrapped by the terminal.
    const term = await withRows(['x https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/end'], 40);
    expect(linksOn(term, 0).map((l) => l.text)).toEqual([
      'https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/end',
    ]);
  });

  it('rejoins every link of a list, including the one the gutter glyph opens', async () => {
    const term = await withRows([
      '⏺ - https://github.com/rbly-internal/api-product/',
      '  pull/161',
      '  - https://github.com/rbly-internal/api-product/',
      '  pull/160',
      '  - https://github.com/rbly-internal/api-product/',
      '  pull/159',
    ]);
    const seen = [0, 1, 2, 3, 4, 5].map((row) => linksOn(term, row).map((l) => l.text));
    expect(seen).toEqual([
      ['https://github.com/rbly-internal/api-product/pull/161'],
      ['https://github.com/rbly-internal/api-product/pull/161'],
      ['https://github.com/rbly-internal/api-product/pull/160'],
      ['https://github.com/rbly-internal/api-product/pull/160'],
      ['https://github.com/rbly-internal/api-product/pull/159'],
      ['https://github.com/rbly-internal/api-product/pull/159'],
    ]);
  });

  it('reports nothing on a row with no link', async () => {
    const term = await withRows(['  8 files, +290/-28']);
    expect(linksOn(term, 0)).toEqual([]);
  });
});
