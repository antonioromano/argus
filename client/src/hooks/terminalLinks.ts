/**
 * Link detection that survives the line breaks agent CLIs write themselves.
 *
 * `WebLinksAddon` only ever sees one *logical* line, and it decides what that is
 * from `isWrapped` — the flag the emulator sets when *it* ran out of columns.
 * Agent CLIs never let that happen: Claude Code (like every Ink TUI) measures the
 * pane, wraps to it, and emits each visual row as its own line with a real `\n`
 * (the same fact `terminalCopy.ts` exists for). A URL longer than the remaining
 * room is split across two such rows, so the addon matches only the fragment on
 * the row under the mouse: the head opens a truncated URL and the tail is not a
 * link at all.
 *
 * So rebuild the logical line the same way copy does — from the geometry of the
 * rows rather than from `isWrapped` — and run the URL regex over that:
 *
 *   - a wrapper only breaks a row it filled, so a row short of the wrap width was
 *     ended by its author and never continues into the row below;
 *   - a row that *is* full joins the next one with a space, unless the break split
 *     a single token, in which case the halves rejoin with nothing between them.
 *
 * The separator is what keeps a wrong guess harmless: the URL regex stops dead at
 * whitespace, so joining two rows that were not one URL simply produces no longer
 * match. Only the no-separator case can extend a URL, and that needs both halves
 * to overflow the line together — which no real pair of adjacent words does.
 *
 * `isWrapped` is still honoured when set, so genuinely emulator-wrapped output
 * (a non-Ink program printing past the right margin) keeps working.
 */

import type { IBufferRange, ILink, ILinkProvider, Terminal } from '@xterm/xterm';

/** Rows scanned in each direction from the hovered row. A URL spanning more than
 *  this many rows is not worth the per-hover cost of finding. */
const MAX_SPAN = 10;

/** Below this, the wrap width measured from the surrounding rows is too likely to
 *  be an accident of short lines — join nothing and trust `isWrapped` alone. */
const MIN_WRAP_WIDTH = 24;

/** Same URL shape `WebLinksAddon` uses, so what counts as a link does not change
 *  with this file. Excludes whitespace (load-bearing — see the header) and the
 *  punctuation that ends a sentence rather than a URL. */
const URL_REGEX = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/g;

/** Rows opening a new structural element are never folded into the row above.
 *  Kept in step with `terminalCopy.ts`, which inverts the same wrap. */
const OPENS_BLOCK = /^(?:[-*+•>|]\s|\d+[.)]\s|#{1,6}\s|[─-▟⏺⎿❯✻✽✢·✘✔✓✗⚠⧗⏵])/u;

/** Box-drawing and block-element leads: their width comes from the frame, not
 *  from the wrapper, so they neither absorb a row nor say how wide text wrapped. */
const IS_CHROME = /^\s*[─-▟]/u;

/** The glyph an agent CLI prints in the *gutter* of a message's first row —
 *  Claude Code's ⏺ and ⎿, a prompt, a spinner. It stands in place of the indent
 *  every other row of that message carries, so the row below a `⏺ ` one is not
 *  indented relative to it: they line up. */
const GUTTER_GLYPH = /^\s*[⏺●⎿❯✻✽✢·✘✔✓✗⚠⧗⏵]\s*/u;

const indentOf = (s: string): number => s.length - s.trimStart().length;

/** Column the row's block starts at — past a gutter glyph, if it has one. */
const blockIndent = (s: string): number => GUTTER_GLYPH.exec(s)?.[0].length ?? indentOf(s);

export interface LinkRow {
  /** Row text with trailing cell padding removed. */
  text: string;
  /** True when the *emulator* wrapped this row from the one above it. */
  isWrapped: boolean;
  /**
   * 0-based cell column of each UTF-16 code unit of `text`. Defaults to one cell
   * per code unit; the terminal-backed reader supplies the real map so wide and
   * astral characters before a URL do not shift its range.
   */
  columns?: () => number[];
}

export interface LinkBuffer {
  /** Row at an absolute buffer index, or undefined past either end. */
  row(y: number): LinkRow | undefined;
}

export interface FoundLink {
  text: string;
  /** 0-based buffer row / cell column, both ends inclusive. */
  startY: number;
  startX: number;
  endY: number;
  endX: number;
}

/** True when the wrapper — not the author — ended `prev` and pushed text onto
 *  `next`. A break that left room for what follows was written by the author. */
function isForcedBreak(prev: string, next: string, limit: number): boolean {
  if (!prev || !next) return false; // a blank row is a paragraph break
  if (IS_CHROME.test(prev)) return false;
  if (OPENS_BLOCK.test(next.trimStart())) return false;
  // Wrapping preserves the block's indent; a change of it is authored structure.
  // One column of slack absorbs hanging indents. Measured past a gutter glyph:
  // `⏺ - https://…` continues into a row indented to where the `-` sits, which
  // against the raw indent (the glyph starts at column 0) reads as a two-column
  // jump — that is what kept the first link of a message from ever joining.
  if (Math.abs(indentOf(next) - blockIndent(prev)) > 1) return false;
  return prev.length >= limit;
}

/**
 * True when the break split a single token, so the halves rejoin with nothing
 * between them. A token is only ever split when it cannot fit a line at all, so
 * the two fragments together must exceed the wrap width.
 */
function isSplitToken(prev: string, next: string, limit: number): boolean {
  if (prev.length !== limit) return false; // a hard split fills the row exactly
  const tail = /\S*$/.exec(prev)![0].length;
  const head = /^\S*/.exec(next.trimStart())![0].length;
  return tail > 0 && head > 0 && tail + head > limit;
}

/** Wrap width the agent laid its transcript out to, measured from the rows around
 *  the one under the mouse. `cols` is the wrong number: agents reserve a gutter
 *  and box padding inside it. Frame rows run wider than the text they surround,
 *  so reading one as the width would starve everything under it. */
function wrapWidth(buf: LinkBuffer, y: number): number {
  let limit = 0;
  for (let i = y - MAX_SPAN; i <= y + MAX_SPAN; i++) {
    const row = buf.row(i);
    if (!row || IS_CHROME.test(row.text)) continue;
    limit = Math.max(limit, row.text.length);
  }
  return limit;
}

/**
 * The addon's guard against URLs that mean something other than they look like:
 * require the text to start with what `URL` parsed as its origin, so a normalised
 * host (unicode, embedded credentials, backslashes) cannot pass for a literal one.
 */
function isPlainUrl(text: string): boolean {
  try {
    const url = new URL(text);
    const origin =
      url.password && url.username
        ? `${url.protocol}//${url.username}:${url.password}@${url.host}`
        : url.username
          ? `${url.protocol}//${url.username}@${url.host}`
          : `${url.protocol}//${url.host}`;
    return text.toLocaleLowerCase().startsWith(origin.toLocaleLowerCase());
  } catch {
    return false;
  }
}

interface Segment {
  y: number;
  /** The row's text as it appears in the joined string — the gutter dropped. */
  text: string;
  columns: () => number[];
  /** Index in the joined string where this row's text starts. */
  offset: number;
  /** Code units of the row dropped from its front, to map back into `columns`. */
  skip: number;
}

/** Rebuild the logical line the hovered row belongs to. */
function joinRows(buf: LinkBuffer, y: number, limit: number): { joined: string; segments: Segment[] } {
  const rows: { y: number; row: LinkRow; glue: string }[] = [];
  const identity = (text: string) => (): number[] => Array.from({ length: text.length }, (_, i) => i);

  const glueFor = (prev: string, next: LinkRow): string | null => {
    if (next.isWrapped) return ''; // the emulator's own wrap, already one line
    if (limit < MIN_WRAP_WIDTH) return null;
    if (!isForcedBreak(prev, next.text, limit)) return null;
    return isSplitToken(prev, next.text, limit) ? '' : ' ';
  };

  const start = buf.row(y);
  if (!start) return { joined: '', segments: [] };
  rows.push({ y, row: start, glue: '' });

  for (let i = y - 1; i >= y - MAX_SPAN; i--) {
    const above = buf.row(i);
    if (!above) break;
    const glue = glueFor(above.text, rows[0].row);
    if (glue === null) break;
    rows[0].glue = glue;
    rows.unshift({ y: i, row: above, glue: '' });
  }

  for (let i = y + 1; i <= y + MAX_SPAN; i++) {
    const below = buf.row(i);
    if (!below) break;
    const glue = glueFor(rows[rows.length - 1].row.text, below);
    if (glue === null) break;
    rows.push({ y: i, row: below, glue });
  }

  let joined = '';
  const segments: Segment[] = [];
  for (const [i, { y: rowY, row, glue }] of rows.entries()) {
    // A continued row still carries the transcript box's left gutter, and a space
    // inside a URL ends it. Drop it — but only where the *agent* broke the line;
    // a row the emulator wrapped starts at column 0 and its spaces are content.
    const skip = i > 0 && !row.isWrapped ? indentOf(row.text) : 0;
    joined += glue;
    segments.push({
      y: rowY,
      text: row.text.slice(skip),
      columns: row.columns ?? identity(row.text),
      offset: joined.length,
      skip,
    });
    joined += row.text.slice(skip);
  }
  return { joined, segments };
}

/** Segment holding a joined-string index, and that index within its row. */
function locate(segments: Segment[], index: number): { segment: Segment; column: number } | undefined {
  for (const segment of segments) {
    const local = index - segment.offset;
    if (local >= 0 && local < segment.text.length) {
      const column = segment.columns()[local + segment.skip];
      return column === undefined ? undefined : { segment, column };
    }
  }
  return undefined;
}

/** Every URL covering row `y`, resolved across the rows it was broken over. */
export function findLinks(buf: LinkBuffer, y: number): FoundLink[] {
  const { joined, segments } = joinRows(buf, y, wrapWidth(buf, y));
  if (!joined) return [];

  const links: FoundLink[] = [];
  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_REGEX.exec(joined))) {
    const text = match[0];
    if (!isPlainUrl(text)) continue;
    const from = locate(segments, match.index);
    const to = locate(segments, match.index + text.length - 1);
    if (!from || !to) continue;
    // The mouse is on this row; a link on the rows we joined past is not ours to
    // report — the provider is asked again for those rows.
    if (from.segment.y > y || to.segment.y < y) continue;
    links.push({
      text,
      startY: from.segment.y,
      startX: from.column,
      endY: to.segment.y,
      endX: to.column,
    });
  }
  return links;
}

/** Read rows out of a live terminal, with a real code-unit → column map. */
function terminalBuffer(terminal: Terminal): LinkBuffer {
  return {
    row(y: number): LinkRow | undefined {
      if (y < 0) return undefined;
      const line = terminal.buffer.active.getLine(y);
      if (!line) return undefined;
      const text = line.translateToString(true);
      return {
        text,
        isWrapped: line.isWrapped,
        columns: () => {
          const columns: number[] = [];
          for (let x = 0; x < line.length && columns.length < text.length; x++) {
            const cell = line.getCell(x);
            if (!cell || cell.getWidth() === 0) continue; // right half of a wide char
            const chars = cell.getChars() || ' '; // a null cell reads as a space
            for (let i = 0; i < chars.length; i++) columns.push(x);
          }
          return columns;
        },
      };
    },
  };
}

/**
 * Link provider to register in place of `WebLinksAddon`. OSC 8 hyperlinks stay
 * with xterm core's own provider (routed by the terminal's `linkHandler`).
 */
export function createTerminalLinkProvider(
  terminal: Terminal,
  activate: (uri: string) => void,
): ILinkProvider {
  const buf = terminalBuffer(terminal);
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
      const found = findLinks(buf, bufferLineNumber - 1);
      if (!found.length) {
        callback(undefined);
        return;
      }
      callback(
        found.map((link) => {
          // xterm ranges are 1-based and inclusive at both ends.
          const range: IBufferRange = {
            start: { x: link.startX + 1, y: link.startY + 1 },
            end: { x: link.endX + 1, y: link.endY + 1 },
          };
          return { text: link.text, range, activate: (_event, uri) => activate(uri) };
        }),
      );
    },
  };
}
