/**
 * Reconstructs source text from a terminal selection, for the clipboard.
 *
 * Agent CLIs lay their own transcript out: Claude Code (like every Ink-based TUI)
 * measures the pane, word-wraps to it, and emits each visual row as its own line
 * with a real `\n` — each carrying the transcript box's left gutter. Nothing
 * downstream can undo that. `tmux capture-pane -J` on a live Argus pane joins
 * nothing because no row is flagged wrapped, and xterm's `getSelection()` has the
 * same nothing to work with: it only joins rows whose `isWrapped` the *emulator*
 * set. Copying the buffer verbatim is therefore faithful and useless — gutter-
 * indented prose, broken at whatever width the tile happened to be. Terminal.app,
 * iTerm2 and Ghostty all produce exactly this; the emulator is not the variable.
 *
 * So rebuild the text at copy time:
 *   1. strip the indent shared by every selected row (the gutter), and
 *   2. rejoin rows whose break was forced by wrapping rather than authored.
 *
 * Step 2 inverts greedy word wrap: a wrapper breaks only when the next word does
 * not fit, so a break that left room for the next word was written by the author
 * and is kept. Rows that open a new structural element, or that change indent, are
 * kept too.
 */

/**
 * Bold-run markers. A copy source that can see cell attributes (the native pane,
 * an xterm tile) wraps each bold run in these so the HTML flavor can keep it —
 * see terminalRichCopy. They are Unicode noncharacters, reserved for internal
 * use and never present in real terminal output, and they occupy no cell: every
 * width measured here ignores them. Markers only ever sit next to non-space
 * characters, so the gutter and trailing padding never contain one.
 */
export const BOLD_ON = '\uFDD0';
export const BOLD_OFF = '\uFDD1';
const MARKS = /[\uFDD0\uFDD1]/g;
export const stripBoldMarks = (s: string): string => s.replace(MARKS, '');

/**
 * Selection start column, as a `\uFDD3<col>\uFDD3` prefix on the copied text. A
 * drag usually starts on the first word, past the gutter (and past Claude's `⏺`),
 * so the first row arrives without the indent every other row has; only the
 * copy source knows where it really began. Same noncharacter family as the marks.
 */
const START_COLUMN = /^\uFDD3(\d+)\uFDD3/;
export const withStartColumn = (text: string, col: number): string => (col > 0 ? `\uFDD3${col}\uFDD3${text}` : text);
export function splitStartColumn(text: string): { col: number; text: string } {
  const m = START_COLUMN.exec(text);
  return m ? { col: Number(m[1]), text: text.slice(m[0].length) } : { col: 0, text };
}

/** Wrap width is measured from the selection, so a short block can look "full" by
 *  accident. Below this, assume nothing was wrapped and only dedent. */
const MIN_WRAP_WIDTH = 24;

/** Rows opening a new structural element are never folded into the row above:
 *  list bullets and ordered items, quotes, headings, table pipes, and the glyphs
 *  agent CLIs draw their chrome with (prompt, tool result, box rules, spinners). */
const OPENS_BLOCK =
  /^(?:[-*+•>|]\s|\d+[.)]\s|#{1,6}\s|[─-▟⏺⎿❯✻✽✢·✘✔✓✗⚠⧗⏵])/u;

/** Box-drawing and block-element leads (U+2500–U+259F): table rows, rules, panel
 *  borders. Their width is set by the frame, not by the wrapper, so they must not
 *  be read as evidence of how wide the agent wrapped text to. */
const IS_CHROME = /^\s*[─-▟]/u;

/** Cell count, near enough for a wrap-width comparison. Counts code points so a
 *  surrogate pair reads as one cell rather than two. */
const width = (s: string): number => [...stripBoldMarks(s)].length;

const indentOf = (s: string): number => width(s) - width(s.trimStart());

/** Where the text of a list-item row starts (`- foo` → 2), or -1 when `row` is
 *  not a list item. */
function textIndentOfItem(row: string): number {
  const marker = /^\s*(?:[-*+•]|\d+[.)])\s+/u.exec(stripBoldMarks(row));
  return marker ? width(marker[0]) : -1;
}

/**
 * True when `next` is the tail of `cur` pushed onto a new row by the wrapper.
 *
 * `cur` is the *source row* that preceded `next`, never the accumulated output —
 * an accumulated line is always past the wrap width, which would make every
 * following row look forced and swallow the authored breaks after the first fold.
 */
function isWrapContinuation(cur: string, next: string, limit: number, ignoreIndent = false): boolean {
  if (!cur || !next) return false; // a blank row is a paragraph break
  // A frame row is drawn to its own width and never spills into prose, in either
  // direction: nothing folds into a rule, and a rule swallows nothing below it.
  if (IS_CHROME.test(stripBoldMarks(cur))) return false;
  // A trailing backslash is a shell line continuation: the break is the author's.
  if (/\\$/.test(stripBoldMarks(cur))) return false;
  const body = next.trimStart();
  if (OPENS_BLOCK.test(stripBoldMarks(body))) return false;
  // Wrapping preserves the block's indent; a change of it is authored structure
  // (nested code, an outdent). One column of slack absorbs hanging indents, and
  // a list item's wrapped rows hang under its text, past the marker.
  const drift = Math.abs(indentOf(next) - indentOf(cur));
  if (!ignoreIndent && drift > 1 && indentOf(next) !== textIndentOfItem(cur)) return false;
  const firstWord = width(/^\S*/.exec(body)![0]);
  // A word wider than the line fits nowhere, so its position says nothing about
  // why the break happened.
  if (firstWord === 0 || firstWord > limit) return false;
  return width(cur) + 1 + firstWord > limit;
}

/**
 * True when the wrapper split a single token across the boundary, so the halves
 * rejoin with nothing between them. A token only gets split when it cannot fit a
 * line at all, so the two fragments together must exceed the width — which no
 * real pair of adjacent words does.
 */
function isSplitToken(cur: string, next: string, limit: number): boolean {
  if (width(cur) !== limit) return false; // a hard split fills the row exactly
  const tail = width(/\S*$/.exec(cur)![0]);
  const head = width(/^\S*/.exec(next.trimStart())![0]);
  return tail > 0 && head > 0 && tail + head > limit;
}

export function terminalSelectionToClipboard(selection: string): string {
  const { col: startCol, text: raw } = splitStartColumn(selection);
  if (!raw) return raw;

  // Trailing cell padding is never content.
  const rows = raw.split(/\r?\n/).map((r) => r.replace(/\s+$/, ''));

  // A drag that began mid-row: put the first row back at the column it came
  // from, so it measures like the rows below it. Its leading spaces are dropped
  // again on the way out — they were never selected.
  const midRow = startCol > 0 && rows.length > 1 && rows[0].length > 0;
  if (midRow) rows[0] = ' '.repeat(startCol) + rows[0];

  // 1. Dedent by the gutter. Computed over non-blank rows only.
  let gutter = Infinity;
  for (const r of rows) {
    if (r.length === 0) continue;
    gutter = Math.min(gutter, indentOf(r));
    if (gutter === 0) break;
  }
  if (!Number.isFinite(gutter)) return rows.join('\n');
  const lines = gutter > 0 ? rows.map((r) => r.slice(gutter)) : rows;
  if (lines.length < 2) return lines.join('\n');

  // 2. Unwrap. The widest selected *text* row is the best available estimate of
  //    the width the agent wrapped to — it survives partial selections and
  //    whatever padding the agent reserves inside its own box, which `cols` does
  //    not. Estimating too high under-joins, so keep frame rows (which run wider
  //    than the text they surround) out of it.
  let limit = 0;
  for (const l of lines) if (!IS_CHROME.test(stripBoldMarks(l))) limit = Math.max(limit, width(l));
  if (limit < MIN_WRAP_WIDTH) {
    if (midRow) lines[0] = lines[0].trimStart();
    return lines.join('\n');
  }

  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    // Where the first row really started is unknown when the drag began inside
    // it (a paragraph row starts at its block's indent, not at the drag), so its
    // indent says nothing about whether the next row continues it.
    if (!isWrapContinuation(prev, line, limit, midRow && i === 1)) {
      out.push(line);
      continue;
    }
    out[out.length - 1] += (isSplitToken(prev, line, limit) ? '' : ' ') + line.trimStart();
  }
  if (midRow) out[0] = out[0].trimStart();
  return out.join('\n');
}
