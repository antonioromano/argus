import type { SearchHit } from '@argus/shared';

/** One buffer row: its text, and whether it continues the row above (soft wrap). */
export interface BufferRow {
  text: string;
  wrapped?: boolean;
}

export const SNIPPET_MAX = 160;

/**
 * A snippet of at most `max` chars centred on the match at `[start, start+len)`
 * of `text`, whitespace runs collapsed. Returns the match's offset inside it.
 */
export function makeSnippet(text: string, start: number, len: number, max = SNIPPET_MAX): Pick<SearchHit, 'snippet' | 'matchStart' | 'matchLength'> {
  const collapse = (s: string) => s.replace(/\s+/g, ' ');
  const before = collapse(text.slice(0, start)).trimStart();
  const match = collapse(text.slice(start, start + len));
  const after = collapse(text.slice(start + len)).trimEnd();
  const matchLength = Math.min(match.length, max);
  const room = Math.max(0, max - matchLength);
  // Prefer context after the match, but give the left side up to half.
  let left = Math.min(before.length, Math.floor(room / 2));
  const right = Math.min(after.length, room - left);
  left = Math.min(before.length, room - right);
  const leftCut = left < before.length;
  const rightCut = right < after.length;
  const head = (leftCut ? '…' : '') + before.slice(before.length - left);
  const snippet = head + match.slice(0, matchLength) + after.slice(0, right) + (rightCut ? '…' : '');
  return { snippet, matchStart: head.length, matchLength };
}

/**
 * Case-insensitive literal search over terminal rows. Soft-wrapped rows are
 * joined back into the logical line they came from, so a match split across
 * a wrap is still found. Returns one hit per matching line, newest (bottom)
 * first, at most `max`. `line` is the row the logical line starts on.
 */
export function searchRows(rows: readonly BufferRow[], query: string, max: number): SearchHit[] {
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  if (!needle || max <= 0) return hits;
  // Walk logical lines bottom-up: end at row `end`, start at the first row of
  // its wrap run.
  let end = rows.length - 1;
  while (end >= 0 && hits.length < max) {
    let start = end;
    while (start > 0 && rows[start]!.wrapped) start--;
    let text = '';
    for (let y = start; y <= end; y++) text += rows[y]!.text;
    const at = text.toLowerCase().indexOf(needle);
    if (at !== -1) hits.push({ source: 'scrollback', line: start, ...makeSnippet(text, at, needle.length) });
    end = start - 1;
  }
  return hits;
}

/**
 * Plain text rows of a serialized replay frame (TerminalMirror.serialize), for
 * a mirror that is hibernated or exited and must not be woken just to search.
 * The serializer emits soft-wrapped rows as one run and hard breaks as CRLF, so
 * splitting on newlines yields logical lines. Runs of blank cells come out as
 * cursor-forward (CSI n C) and are turned back into spaces; every other escape
 * is dropped. Row indices are not recoverable from this form.
 */
export function frameToRows(frame: string): BufferRow[] {
  const text = frame
    // CSI n C (cursor forward) stands in for blank cells.
    .replace(/\x1b\[(\d*)C/g, (_m, n: string) => ' '.repeat(Math.min(Number(n) || 1, 1000)))
    // OSC … BEL / ST
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // other CSI sequences
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    // two-char escapes (charset selection, keypad modes, …)
    .replace(/\x1b[()*+][0-9A-Za-z]|\x1b[@-_]/g, '')
    // stray C0 controls except newline
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
  return text.split('\n').map((t) => ({ text: t }));
}
