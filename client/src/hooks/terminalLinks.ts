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
 * match. Only the no-separator case can extend a URL, so it is taken only where a
 * URL is still open at the break — see `isSplitToken`.
 *
 * `isWrapped` is still honoured when set, so genuinely emulator-wrapped output
 * (a non-Ink program printing past the right margin) keeps working.
 *
 * A box-drawn table is the same wrap one level in: each cell is laid out to its
 * own column, so the halves of a split URL are separated by the other columns'
 * text and no amount of row joining puts them back together. Those rows are cut
 * out of their frame first and the same joining runs down a single cell — see
 * `cellBuffer`.
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

/** A URL began in this token and no whitespace has ended it. */
const URL_OPENED = /(?:https?|HTTPS?):[/]{2}/;

/**
 * True when the break split a single token, so the halves rejoin with nothing
 * between them.
 *
 * The wrapper splits a token when it overruns the room left *on that row*, not
 * only when the token could not fit a row of its own: `  - PR: <59-char URL>` at a
 * 59-column wrap breaks mid-URL even though the URL alone would have fit a fresh
 * row — the prefix ate the difference. So "the fragments together exceed the wrap
 * width" is too strict, and its correct form — they exceed the room the token had —
 * is trivially true of every filled row, which would also swallow the space a word
 * break dropped off the end.
 *
 * Take the wider reading only while a URL is still open on `prev`: joining there can
 * lengthen a link but never invent one, and a URL cannot contain the space that
 * would otherwise be spliced into it. Elsewhere the length test still decides, so
 * ordinary prose keeps its space.
 */
function isSplitToken(prev: string, next: string, limit: number): boolean {
  if (prev.length !== limit) return false; // a hard split fills the row exactly
  const tail = /\S*$/.exec(prev)![0];
  const head = /^\S*/.exec(next.trimStart())![0];
  if (!tail || !head) return false;
  if (URL_OPENED.test(tail)) return true;
  return tail.length + head.length > limit;
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

/** Every URL covering row `y` of a buffer whose rows are whole logical lines. */
function linksOnLine(buf: LinkBuffer, y: number): FoundLink[] {
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

/** The rule a box-drawn table puts between its cells. */
const CELL_RULE = '│';

interface TableLayout {
  /** Code-unit index of each rule in the row. */
  seps: number[];
  /** Cell column of each rule — what matches one row's frame against another's,
   *  since a wide character earlier in the row shifts the indexes but not the frame. */
  ruleColumns: number[];
}

/** The frame of a table row, or undefined for a row that is not one. */
function tableLayout(row: LinkRow): TableLayout | undefined {
  const seps: number[] = [];
  for (let i = 0; i < row.text.length; i++) if (row.text[i] === CELL_RULE) seps.push(i);
  if (seps.length < 2) return undefined; // a pair of rules is the least a cell needs
  if (row.text.slice(0, seps[0]).trim() !== '') return undefined; // text outside the frame
  const columns = row.columns?.();
  return { seps, ruleColumns: columns ? seps.map((i) => columns[i] ?? i) : seps };
}

/**
 * One column of a table read as a buffer of its own, so the joining above runs
 * over the cell's own text and measures the cell's own wrap width.
 *
 * A row framed differently from the hovered one ends the column: a border row
 * (`├─┼─┤`) carries no rules at all, and a second table or plain prose
 * carries them elsewhere. That is also what keeps one table row's last line from
 * absorbing the next row's first — for the unruled borders agents draw between
 * rows. Where there is no border, the ordinary guard applies: the last line of a
 * cell is short of the wrap width, so nothing joins onto it.
 */
function cellBuffer(buf: LinkBuffer, layout: TableLayout, cell: number): LinkBuffer {
  const sameFrame = (other: TableLayout): boolean =>
    other.ruleColumns.length === layout.ruleColumns.length &&
    other.ruleColumns.every((column, i) => column === layout.ruleColumns[i]);
  return {
    row(y: number): LinkRow | undefined {
      const row = buf.row(y);
      if (!row) return undefined;
      const frame = tableLayout(row);
      if (!frame || !sameFrame(frame)) return undefined;
      const from = frame.seps[cell] + 1;
      const columns = row.columns ?? identityColumns(row.text);
      return {
        // Trailing pad is the frame's, not the cell's: without dropping it the
        // cell never reads as filled to its width and so never joins.
        text: row.text.slice(from, frame.seps[cell + 1]).trimEnd(),
        isWrapped: false, // a cell is wrapped by the agent, never by the emulator
        columns: () => columns().slice(from),
      };
    },
  };
}

const identityColumns =
  (text: string) =>
  (): number[] =>
    Array.from({ length: text.length }, (_, i) => i);

/** The row with its cell walk run at most once. */
function once(row: LinkRow | undefined): LinkRow | undefined {
  const columns = row?.columns;
  if (!row || !columns) return row;
  let cached: number[] | undefined;
  return { ...row, columns: () => (cached ??= columns()) };
}

/** Read each row — and its cell walk — at most once per lookup. Every cell of a
 *  table row asks for the same rows over again. */
function memoize(buf: LinkBuffer): LinkBuffer {
  const rows = new Map<number, LinkRow | undefined>();
  return {
    row(y: number): LinkRow | undefined {
      if (!rows.has(y)) rows.set(y, once(buf.row(y)));
      return rows.get(y);
    },
  };
}

/** Every URL covering row `y`, resolved across the rows it was broken over. */
export function findLinks(source: LinkBuffer, y: number): FoundLink[] {
  const buf = memoize(source);
  const row = buf.row(y);
  if (!row) return [];
  const layout = tableLayout(row);
  if (!layout) return linksOnLine(buf, y);
  const links: FoundLink[] = [];
  for (let cell = 0; cell + 1 < layout.seps.length; cell++) {
    links.push(...linksOnLine(memoize(cellBuffer(buf, layout, cell)), y));
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
