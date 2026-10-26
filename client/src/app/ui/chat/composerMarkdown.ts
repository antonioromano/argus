/**
 * Live Markdown in the Chat composer (D2). The composer stays a plain
 * textarea whose value is the Markdown sent to Claude; this module holds the
 * pure parts: list editing on Enter / Tab (an edit is the whole new value plus
 * the selection) and the line model the highlight layer under the textarea is
 * drawn from. Nothing here changes what is sent, only how it is typed and shown.
 */

/** A list item's leading part: indent, marker, spacing and an optional task box. */
const ITEM_RE = /^( *)([-*+]|(\d{1,9})([.)]))( +)(\[[ xX]\] )?/;
const FENCE_RE = /^ *(```+|~~~+)/;

/** `line` closes a fence opened with `char`: the same fence character and nothing after it. */
function closesFence(line: string, char: string): boolean {
  const m = FENCE_RE.exec(line);
  return !!m && m[1][0] === char && !line.slice(m[0].length).trim();
}

export interface Edit {
  value: string;
  selStart: number;
  selEnd: number;
}

interface Item {
  indent: number;
  /** `-`, `*`, `+`, or the delimiter of a numbered item (`.` / `)`). */
  bullet?: string;
  num?: number;
  delim?: string;
  /** Indent + marker + spacing + task box: where the item's text starts. */
  contentAt: number;
  task: boolean;
}

function itemOf(line: string): Item | undefined {
  const m = ITEM_RE.exec(line);
  if (!m) return undefined;
  const base = { indent: m[1].length, contentAt: m[0].length, task: !!m[6] };
  return m[3] ? { ...base, num: Number(m[3]), delim: m[4] } : { ...base, bullet: m[2] };
}

function lineBounds(value: string, pos: number): { start: number; end: number } {
  const start = value.lastIndexOf('\n', pos - 1) + 1;
  const nl = value.indexOf('\n', pos);
  return { start, end: nl < 0 ? value.length : nl };
}

/** True when `pos` sits inside an unclosed ``` / ~~~ block (its opening line included). */
export function inCodeFence(value: string, pos: number): boolean {
  const { end } = lineBounds(value, pos);
  let open: string | null = null;
  for (const line of value.slice(0, end).split('\n')) {
    if (open) {
      if (closesFence(line, open)) open = null;
    } else {
      open = FENCE_RE.exec(line)?.[1][0] ?? null;
    }
  }
  return open !== null;
}

/**
 * Renumber every run of numbered items so each counts up from its first
 * item; `pos` is mapped through the change. Runs are per indent level, nested
 * lines keep the outer run going, a blank line or a fence ends them.
 */
export function renumber(value: string, pos: number): { value: string; pos: number } {
  const r = renumberAll(value, [pos]);
  return { value: r.value, pos: r.positions[0] };
}

/** renumber() mapping several positions through the change in one pass. */
function renumberAll(value: string, positions: number[]): { value: string; positions: number[] } {
  const lines = value.split('\n');
  const runs = new Map<number, number>();
  let fence: string | null = null;
  let offset = 0;
  const shifts = positions.map(() => 0);
  const out: string[] = [];
  for (const line of lines) {
    let next = line;
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (closesFence(line, fence)) fence = null;
    } else if (f) {
      fence = f[1][0];
      runs.clear();
    } else if (!line.trim()) {
      runs.clear();
    } else {
      const item = itemOf(line);
      const indent = item ? item.indent : line.length - line.trimStart().length;
      for (const k of [...runs.keys()]) if (item ? k > indent : k >= indent) runs.delete(k);
      if (item?.num !== undefined) {
        const last = runs.get(indent);
        const num = last === undefined ? item.num : last + 1;
        runs.set(indent, num);
        if (num !== item.num) {
          const old = String(item.num);
          next = line.slice(0, indent) + num + line.slice(indent + old.length);
          positions.forEach((pos, i) => {
            if (offset + indent < pos) shifts[i] += next.length - line.length;
          });
        }
      } else if (item) {
        runs.delete(indent);
      }
    }
    out.push(next);
    offset += line.length + 1;
  }
  return { value: out.join('\n'), positions: positions.map((pos, i) => pos + shifts[i]) };
}

function withRenumber(value: string, caret: number): Edit {
  const r = renumber(value, caret);
  return { value: r.value, selStart: r.pos, selEnd: r.pos };
}

/**
 * Enter inside a list item: continue the list with the next marker, or end
 * it on an empty item (one level out when nested). Inside an open code fence:
 * a new line keeping the indent. Undefined when Enter should send.
 */
export function enterEdit(value: string, selStart: number, selEnd: number): Edit | undefined {
  // A selection where Enter edits is replaced by the new line, as in any editor.
  if (selStart !== selEnd) {
    return enterContinues(value, selStart) ? enterEdit(value.slice(0, selStart) + value.slice(selEnd), selStart, selStart) : undefined;
  }
  const { start, end } = lineBounds(value, selStart);
  const line = value.slice(start, end);
  if (inCodeFence(value, selStart)) {
    const indent = /^ */.exec(line)![0];
    const v = value.slice(0, selStart) + '\n' + indent + value.slice(selEnd);
    const at = selStart + 1 + indent.length;
    return { value: v, selStart: at, selEnd: at };
  }
  const item = itemOf(line);
  if (!item || selStart < start + item.contentAt) return undefined;
  if (!line.slice(item.contentAt).trim()) {
    // An empty item: nested ones step out a level, top-level ones end the list.
    if (item.indent > 0) return outdentLine(value, start, line, item, selStart);
    const v = value.slice(0, start) + value.slice(end);
    return withRenumber(v, start);
  }
  const marker = item.num !== undefined ? `${item.num + 1}${item.delim}` : item.bullet!;
  const insert = '\n' + ' '.repeat(item.indent) + marker + ' ' + (item.task ? '[ ] ' : '');
  const v = value.slice(0, selStart) + insert + value.slice(selEnd).replace(/^ +/, '');
  return withRenumber(v, selStart + insert.length);
}

/** The nearest list item above line `start`, with an indent `test` accepts. */
function itemAbove(value: string, start: number, test: (indent: number) => boolean): Item | undefined {
  let end = start - 1;
  while (end > 0) {
    const s = value.lastIndexOf('\n', end - 1) + 1;
    const line = value.slice(s, end);
    if (!line.trim()) return undefined;
    const item = itemOf(line);
    if (item && test(item.indent)) return item;
    end = s - 1;
  }
  return undefined;
}

/** A numbered item that changes level restarts at 1; renumber() then joins it to a run. */
function relevel(line: string, item: Item, indent: number): string {
  const rest = line.slice(item.indent);
  const marker = item.num !== undefined ? rest.replace(/^\d+/, '1') : rest;
  return ' '.repeat(indent) + marker;
}

function outdentLine(value: string, start: number, line: string, item: Item, caret: number): Edit {
  const parent = itemAbove(value, start, (k) => k < item.indent);
  const indent = parent ? parent.indent : 0;
  const next = relevel(line, item, indent);
  const v = value.slice(0, start) + next + value.slice(start + line.length);
  return withRenumber(v, Math.max(start, caret + next.length - line.length));
}

/**
 * Tab / Shift+Tab on list items (every item the selection touches): nest
 * under the item above, or step out a level. Undefined when nothing can move
 * (no list item selected, the first item, a top-level Shift+Tab), so Tab keeps
 * moving focus elsewhere.
 */
export function indentEdit(value: string, selStart: number, selEnd: number, outdent: boolean): Edit | undefined {
  const first = lineBounds(value, selStart).start;
  // A selection ending at the start of a line does not touch that line.
  const lastPos = selEnd > selStart && value[selEnd - 1] === '\n' ? selEnd - 1 : selEnd;
  const last = lineBounds(value, lastPos).end;
  const lines = value.slice(first, last).split('\n');
  if (!lines.some((l) => itemOf(l))) return undefined;
  let v = value;
  let s = selStart;
  let e = selEnd;
  let at = first;
  for (const line of lines) {
    const item = itemOf(line);
    let next = line;
    if (item && outdent && item.indent > 0) {
      const parent = itemAbove(v, at, (k) => k < item.indent);
      next = relevel(line, item, parent ? parent.indent : 0);
    } else if (item && !outdent) {
      const sibling = itemAbove(v, at, (k) => k <= item.indent);
      if (sibling && sibling.indent === item.indent) next = relevel(line, item, sibling.contentAt);
    }
    const delta = next.length - line.length;
    if (delta !== 0) {
      v = v.slice(0, at) + next + v.slice(at + line.length);
      // The selection shifts with the text it is in; a caret in the indent stays put.
      if (s > at) s = Math.max(at, s + delta);
      if (e > at) e = Math.max(at, e + delta);
    }
    at += next.length + 1;
  }
  if (v === value) return undefined;
  const r = renumberAll(v, [s, e]);
  return { value: r.value, selStart: r.positions[0], selEnd: r.positions[1] };
}

/** True when Enter at the caret edits (a list item or code fence) instead of sending. */
export function enterContinues(value: string, pos: number): boolean {
  if (inCodeFence(value, pos)) return true;
  const { start } = lineBounds(value, pos);
  const item = itemOf(value.slice(start, lineBounds(value, pos).end));
  return !!item && pos >= start + item.contentAt;
}

// ── Highlight layer ───────────────────────────────────────────────────────

/** One styled run of a line; `text` is always the exact source characters. */
export interface Span {
  text: string;
  /** Markup characters (`**`, `` ` ``, `#`…), drawn dimmed. */
  mark?: boolean;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** A bullet or number at the head of a list item. */
  bullet?: boolean;
  number?: boolean;
}

export type Line =
  | { kind: 'text'; spans: Span[]; heading?: boolean; quote?: boolean }
  | { kind: 'fence'; text: string }
  /** A run of lines inside a fence, highlighted as one block. */
  | { kind: 'code'; lang: string | null; lines: string[] };

const INLINE_RE = /(`+)(?!`)([\s\S]*?[^`])\1(?!`)|(\*\*|(?<![\w_])__)(?=\S)([\s\S]*?\S)\3(?!(?<=__)[\w_])|(?<![\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)|(?<![\w_])_(?=[^\s_])([^_]*?[^\s_])_(?![\w_])/g;

/** Inline Markdown of one line (code, bold, italic, nested once), characters untouched. */
export function inlineSpans(text: string, style: Pick<Span, 'bold' | 'italic'> = {}): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index!;
    if (at > last) out.push({ text: text.slice(last, at), ...style });
    if (m[1]) {
      out.push({ text: m[1], mark: true }, { text: m[2], code: true }, { text: m[1], mark: true });
    } else {
      const [marker, inner, next] = m[3]
        ? [m[3], m[4], { ...style, bold: true }]
        : [m[0][0], m[5] ?? m[6], { ...style, italic: true }];
      out.push({ text: marker, mark: true, ...style }, ...inlineSpans(inner, next), { text: marker, mark: true, ...style });
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), ...style });
  return out;
}

/** The composer text as highlight lines; joining every line's text with `\n` gives the input back. */
export function composerLines(value: string): Line[] {
  const out: Line[] = [];
  let fence: { char: string; lang: string | null; lines: string[] } | null = null;
  for (const line of value.split('\n')) {
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (closesFence(line, fence.char)) {
        out.push({ kind: 'code', lang: fence.lang, lines: fence.lines }, { kind: 'fence', text: line });
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    if (f) {
      fence = { char: f[1][0], lang: line.slice(f[0].length).trim().split(/\s/)[0] || null, lines: [] };
      out.push({ kind: 'fence', text: line });
      continue;
    }
    const heading = /^ {0,3}#{1,6} /.exec(line);
    if (heading) {
      out.push({ kind: 'text', heading: true, spans: [{ text: heading[0], mark: true }, ...inlineSpans(line.slice(heading[0].length), { bold: true })] });
      continue;
    }
    const quote = /^ {0,3}> ?/.exec(line);
    if (quote) {
      out.push({ kind: 'text', quote: true, spans: [{ text: quote[0], mark: true }, ...inlineSpans(line.slice(quote[0].length))] });
      continue;
    }
    const m = ITEM_RE.exec(line);
    if (m) {
      const spans: Span[] = [];
      if (m[1]) spans.push({ text: m[1] });
      spans.push(m[3] ? { text: m[2], number: true } : { text: m[2], bullet: true });
      spans.push({ text: m[5] + (m[6] ?? '') });
      out.push({ kind: 'text', spans: [...spans, ...inlineSpans(line.slice(m[0].length))] });
      continue;
    }
    out.push({ kind: 'text', spans: inlineSpans(line) });
  }
  // An unclosed fence still shows its code.
  if (fence) out.push({ kind: 'code', lang: fence.lang, lines: fence.lines });
  return out;
}
