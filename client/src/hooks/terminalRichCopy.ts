/**
 * Renders copied terminal text as HTML, for the `text/html` clipboard flavor.
 *
 * `terminalSelectionToClipboard` gives back the source text — dedented, unwrapped —
 * but plain text has no lists and no bold. Paste it into Slack, Gmail, Google Docs
 * or Outlook and the bullets arrive as typed `•` characters. Those apps all prefer
 * HTML when the clipboard carries it, so every copy also writes this rendering
 * next to the plain text. Plain-text targets (shells, editors) keep reading
 * `text/plain` and are unaffected.
 *
 * The HTML is written in Google Docs' clipboard dialect, not plain semantic HTML:
 * a `<b id="docs-internal-guid-…">` wrapper, styled spans instead of `<b>`, and
 * nested lists as siblings of their parent `<li>`. Slack keeps bold and links
 * from any HTML but flattens ordinary `<ul>` lists into "•" text; it only builds
 * real lists from content it recognises as a Google Docs copy. Gmail, Docs and
 * Notion read the dialect like any other HTML.
 *
 * The input is what agents print, which is markdown-ish rather than markdown.
 * Claude Code renders markdown before printing it, so `#` and `*` never survive
 * as markup — a row starting with them is code (a shell comment, a cron line):
 *   - `-`/`•` and `1.`/`1)` rows become real lists, nested by indent;
 *   - an indented row under a list item continues that item;
 *   - a block with indented rows or `\` line continuations is code, and stays
 *     monospaced with its indentation, as do box-drawn tables;
 *   - every other row is its own paragraph, and a blank row adds a gap, because
 *     terminalCopy has already rejoined the breaks the wrapper made;
 *   - bold runs the source marked from cell attributes (BOLD_ON/BOLD_OFF) become
 *     bold. Agents render `**x**` as terminal bold and drop the asterisks, so
 *     without the attributes the bold would be gone by the time it is copied.
 */

import { BOLD_OFF, BOLD_ON, stripBoldMarks, terminalSelectionToClipboard, withStartColumn } from './terminalCopy.js';

/** Bullet or number, each optionally flanked by bold marks (a bold item's run
 *  opens on its bullet glyph). */
const LIST_ITEM = /^(\s*)([\uFDD0\uFDD1]*)([-•◦▪‣]|(\d+)[.)])([\uFDD0\uFDD1]*)\s+(.*)$/u;
/** Box-drawing and block elements (U+2500–U+259F) lead table rows and panel rules. */
const CHROME = /^\s*[─-▟]/u;
/** Agent response / tool-result markers that open a row; not content. */
const MARKER = /^[⏺⎿]\s?/u;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const indentOf = (s: string): number => s.length - s.trimStart().length;

/**
 * Bold marks to `<b>`, balanced: a run left open is closed at the end and a
 * stray close is dropped, so a fragment can never bleed bold into the next one.
 * A run that only pauses across whitespace (a wrapped row rejoined) is one run.
 */
function boldMarksToHtml(s: string): string {
  let open = false;
  let out = '';
  for (const ch of s.replace(/\uFDD1(\s*)\uFDD0/g, '$1')) {
    if (ch === BOLD_ON) {
      if (!open) out += '<b>';
      open = true;
    } else if (ch === BOLD_OFF) {
      if (open) out += '</b>';
      open = false;
    } else {
      out += ch;
    }
  }
  return open ? `${out}</b>` : out;
}

/**
 * Inline markup to simple semantic tags: `<code>`, `<a>`, `<b>`, `<i>`, `<s>`.
 * Exported for tests; the clipboard gets these restyled by `docsSpans`.
 */
export function inlineToHtml(text: string): string {
  // Code spans first, parked behind placeholders so nothing inside them is
  // read as markup. U+FDD2 is a noncharacter, like the bold marks.
  const codes: string[] = [];
  let s = text.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codes.push(`<code>${escapeHtml(stripBoldMarks(code))}</code>`);
    return `\uFDD2${codes.length - 1}\uFDD2`;
  });
  s = escapeHtml(s);
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s\uFDD0\uFDD1]+)\)/g, '<a href="$2">$1</a>');
  // Bare URLs, skipping ones already inside an href or anchor body.
  s = s.replace(
    /(^|[^"'>\w])(https?:\/\/[^\s<\uFDD0\uFDD1]*[^\s<.,;:!?)\]'"\uFDD0\uFDD1])/g,
    '$1<a href="$2">$2</a>',
  );
  // `**x**` and `*x*` are both bold: agents writing for Slack use the single form.
  // Delimiters must hug the text, so `2 * 3 * 4` is left alone.
  s = s.replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1<b>$2</b>');
  // `_x_` only at word boundaries, so snake_case identifiers survive.
  s = s.replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<s>$1</s>');
  s = boldMarksToHtml(s);
  return s.replace(/\uFDD2(\d+)\uFDD2/g, (_m, i: string) => codes[Number(i)]);
}

// ── Google Docs dialect ─────────────────────────────────────────────────────
// Only the properties that carry meaning are set; font, size and colour are
// left to the paste target so the text matches what is around it.

const P_STYLE = 'line-height:1.38;margin-top:0pt;margin-bottom:0pt;';
const LIST_STYLE = 'margin-top:0;margin-bottom:0;padding-inline-start:48px;';
const MONO = "font-family:'Courier New',Courier,monospace;";

function spanStyle(bold: boolean, italic: boolean, strike: boolean, underline: boolean, mono: boolean): string {
  const decoration = [underline && 'underline', strike && 'line-through'].filter(Boolean).join(' ') || 'none';
  return (
    `${mono ? MONO : ''}background-color:transparent;font-weight:${bold ? 700 : 400};` +
    `font-style:${italic ? 'italic' : 'normal'};font-variant:normal;text-decoration:${decoration};` +
    'vertical-align:baseline;white-space:pre;white-space:pre-wrap;'
  );
}

/** `inlineToHtml`'s tags restyled as Docs spans: one span per run of text, the
 *  run's bold/italic/strike/code state in its style, links around their span. */
function docsSpans(simple: string, mono = false): string {
  let bold = 0;
  let italic = 0;
  let strike = 0;
  let code = 0;
  let href: string | null = null;
  let out = '';
  const TOKEN = /<(\/?)(b|i|s|code)>|<a href="([^"]*)">|<\/a>|<br>|([^<]+)/g;
  for (const m of simple.matchAll(TOKEN)) {
    const [whole, close, tag, link, text] = m;
    if (text !== undefined) {
      const span = `<span style="${spanStyle(bold > 0, italic > 0, strike > 0, href !== null, mono || code > 0)}">${text}</span>`;
      out += href !== null ? `<a href="${href}" style="text-decoration:none;">${span}</a>` : span;
    } else if (link !== undefined) {
      href = link;
    } else if (whole === '</a>') {
      href = null;
    } else if (whole === '<br>') {
      out += '<br>';
    } else {
      const d = close ? -1 : 1;
      if (tag === 'b') bold += d;
      else if (tag === 'i') italic += d;
      else if (tag === 's') strike += d;
      else code += d;
    }
  }
  return out;
}

const docsParagraph = (spans: string): string => `<p dir="ltr" style="${P_STYLE}">${spans}</p>`;

/** A code row: verbatim, monospaced, its leading spaces kept by pre-wrap. */
const docsCodeRow = (row: string): string =>
  docsParagraph(row ? docsSpans(escapeHtml(row), true) : '<br>');

const BULLET_STYLES = ['disc', 'circle', 'square'];
const NUMBER_STYLES = ['decimal', 'lower-alpha', 'lower-roman'];

interface ListLevel {
  indent: number;
  tag: 'ul' | 'ol';
}

/** A paragraph block is code when its rows carry structure prose never has. */
function looksLikeCode(rows: string[]): boolean {
  const base = indentOf(rows[0]);
  return rows.some((r) => /\\$/.test(r) || indentOf(r) > base);
}

/** Converts copied terminal text to clipboard HTML. `docsId` makes the Docs
 *  wrapper id deterministic for tests. */
export function terminalTextToHtml(text: string, docsId: string = crypto.randomUUID()): string {
  if (!stripBoldMarks(text).trim()) return '';
  const out: string[] = [];
  const lists: ListLevel[] = [];
  let block: string[] = []; // rows of the current non-list block, raw
  let item: string[] | null = null; // the open list item's rows, as spans
  let gap = false; // a blank row separates what was emitted from what comes next
  let blankInList = false; // a blank row inside a list: a gap only if the list ends

  const emitBlock = (html: string) => {
    if (gap && out.length) out.push('<br>');
    gap = false;
    out.push(html);
  };
  const flushBlock = () => {
    if (!block.length) return;
    const rows = block;
    block = [];
    const code = rows.some((r) => CHROME.test(r)) || looksLikeCode(rows);
    if (code) {
      const base = Math.min(...rows.map(indentOf));
      emitBlock(rows.map((r) => docsCodeRow(stripBoldMarks(r).slice(base))).join(''));
    } else {
      emitBlock(rows.map((r) => docsParagraph(docsSpans(inlineToHtml(r.trim())))).join(''));
    }
  };
  const flushItem = () => {
    if (!item) return;
    const depth = lists.length;
    const level = lists[depth - 1];
    const styles = level.tag === 'ol' ? NUMBER_STYLES : BULLET_STYLES;
    out.push(
      `<li dir="ltr" style="list-style-type:${styles[(depth - 1) % 3]};" aria-level="${depth}">` +
        `<p dir="ltr" style="${P_STYLE}" role="presentation">${item.join('<br>')}</p></li>`,
    );
    item = null;
  };
  const closeListsTo = (depth: number) => {
    flushItem();
    while (lists.length > depth) out.push(`</${lists.pop()!.tag}>`);
  };

  for (const raw of text.split('\n')) {
    const line = raw.replace(MARKER, '').replace(/\s+$/, '');
    const bare = stripBoldMarks(line);

    if (!bare.trim()) {
      // Inside a list a blank row is spacing between items, not a new block.
      if (lists.length) blankInList = true;
      else {
        flushBlock();
        gap = true;
      }
      continue;
    }

    const listItem = LIST_ITEM.exec(line);
    if (listItem) {
      flushBlock();
      blankInList = false;
      const indent = listItem[1].length;
      const num = listItem[4];
      const tag: ListLevel['tag'] = num !== undefined ? 'ol' : 'ul';
      flushItem();
      while (lists.length && lists[lists.length - 1].indent > indent) closeListsTo(lists.length - 1);
      const top = lists[lists.length - 1];
      if (!top || top.indent !== indent || top.tag !== tag) {
        if (top && top.indent === indent) closeListsTo(lists.length - 1);
        const start = tag === 'ol' && num !== '1' && !lists.length ? ` start="${num}"` : '';
        const open = `<${tag}${start} style="${LIST_STYLE}">`;
        if (lists.length) out.push(open);
        else emitBlock(open);
        lists.push({ indent, tag });
      }
      // A run that opened on the bullet carries on into the item text.
      const opensBold = (listItem[2] + listItem[5]).endsWith(BOLD_ON);
      item = [docsSpans(inlineToHtml((opensBold ? BOLD_ON : '') + listItem[6]))];
      continue;
    }

    // An indented row under an open item continues it.
    const top = lists[lists.length - 1];
    if (top && item && indentOf(bare) > top.indent) {
      item.push(docsSpans(inlineToHtml(line.trim())));
      continue;
    }

    if (lists.length) {
      closeListsTo(0);
      gap = blankInList;
      blankInList = false;
    }
    block.push(line);
  }
  flushBlock();
  closeListsTo(0);

  // The charset meta keeps `•`, `—` and friends from turning into mojibake in
  // apps that read the macOS HTML pasteboard as Latin-1 without it.
  return (
    `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-${docsId}">` +
    `${out.join('')}</b>`
  );
}

/** Both clipboard flavors for a selection that may carry bold marks. */
export function terminalCopyFlavors(selection: string): { text: string; html: string } {
  const clean = terminalSelectionToClipboard(selection);
  return { text: stripBoldMarks(clean), html: terminalTextToHtml(clean) };
}

/** The slice of an xterm Terminal that copying reads. */
interface XtermSelectionSource {
  hasSelection(): boolean;
  getSelection(): string;
  getSelectionPosition(): { start: { x: number; y: number }; end: { x: number; y: number } } | undefined;
  buffer: {
    active: {
      getLine(y: number):
        | { isWrapped: boolean; length: number; getCell(x: number): { getChars(): string; getWidth(): number; isBold(): number } | undefined }
        | undefined;
    };
  };
}

/** One row of (character, bold) cells as text, with bold runs marked. A run
 *  opens and closes only on a non-space character, so leading and trailing
 *  whitespace stay mark-free. Trailing whitespace is padding and dropped, unless
 *  the row soft-wraps into the next, where it may be the space between words. */
export function markBoldRuns(cells: ReadonlyArray<{ ch: string; bold: boolean }>, keepTrailing = false): string {
  let end = cells.length;
  while (!keepTrailing && end > 0 && !cells[end - 1].ch.trim()) end--;
  let out = '';
  let open = false;
  // Whitespace is held back until the next visible character decides which side
  // of a mark it falls on: a run closes right after its last visible character
  // and opens right before its first.
  let gap = '';
  for (let i = 0; i < end; i++) {
    const { ch, bold } = cells[i];
    if (!ch.trim()) {
      gap += ch;
      continue;
    }
    if (bold !== open) {
      out += open ? BOLD_OFF + gap : gap + BOLD_ON;
      open = bold;
    } else {
      out += gap;
    }
    gap = '';
    out += ch;
  }
  return (open ? out + BOLD_OFF : out) + gap;
}

/**
 * xterm's selection with bold runs marked, read off the buffer cells, prefixed
 * with its start column (see withStartColumn). Falls back to getSelection() when
 * nothing selected is bold, so a selection without bold copies as it always has.
 * Selection coordinates are the 0-based buffer columns/rows of the selection
 * model, end column exclusive.
 */
export function xtermSelectionWithBold(terminal: XtermSelectionSource): string {
  const plain = terminal.getSelection();
  const range = terminal.getSelectionPosition();
  if (!range) return plain;
  const { start, end } = range;
  const buffer = terminal.buffer.active;
  let text = '';
  let anyBold = false;
  for (let y = start.y; y <= end.y; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const from = y === start.y ? start.x : 0;
    const to = y === end.y ? Math.min(end.x, line.length) : line.length;
    const cells: { ch: string; bold: boolean }[] = [];
    for (let x = from; x < to; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) continue; // trailing half of a wide char
      const bold = cell.isBold() !== 0;
      anyBold ||= bold;
      cells.push({ ch: cell.getChars() || ' ', bold });
    }
    if (y > start.y && !line.isWrapped) text += '\n';
    text += markBoldRuns(cells, y < end.y && buffer.getLine(y + 1)?.isWrapped === true);
  }
  // A run broken only by a soft wrap is one run.
  return withStartColumn(anyBold ? text.replaceAll(BOLD_OFF + BOLD_ON, '') : plain, start.x);
}
