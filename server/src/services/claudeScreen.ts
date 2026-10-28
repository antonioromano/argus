import type { Terminal as XTerminal } from '@xterm/headless';

/**
 * Claude Code's permission mode, read from the footer line it paints under the
 * prompt (B1 Chat view), e.g. `⏵⏵ auto mode on (shift+tab to cycle)` or
 * `⏸ manual mode on`. Anchored on the footer glyphs so a transcript line that
 * merely mentions "plan mode on" never matches.
 */
const FOOTER_MODE = /^\s*(?:⏵⏵|⏸)\s+(auto mode|manual mode|accept edits|plan mode|bypass permissions) on\b/i;

const MODE_IDS: Record<string, string> = {
  'auto mode': 'auto',
  'manual mode': 'default',
  'accept edits': 'acceptEdits',
  'plan mode': 'plan',
  'bypass permissions': 'bypassPermissions',
};

/** Modes the Chat view can ask for (the transcript's `permissionMode` values). */
export const SETTABLE_PERMISSION_MODES: readonly string[] = Object.values(MODE_IDS);

/** Shift+Tab: Claude Code cycles its permission mode on it. */
export const CYCLE_MODE_KEY = '\x1b[Z';

/** The mode shown in the bottom rows of a Claude screen, or undefined when no footer is visible. */
export function permissionModeFromFooter(rows: readonly string[]): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = FOOTER_MODE.exec(rows[i]);
    if (m) return MODE_IDS[m[1].toLowerCase()];
  }
  return undefined;
}

/**
 * The text in Claude's input box: the lowest `❯` row near the bottom (rows
 * echoing earlier prompts sit above it). Undefined when no prompt is shown.
 */
export function promptInputText(rows: readonly string[]): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = /^\s*❯(?:\s(.*))?$/.exec(rows[i]);
    if (m) return (m[1] ?? '').trim();
  }
  return undefined;
}

/**
 * True when text the Chat view typed is still sitting in the input box, i.e.
 * its Enter was taken as part of the paste instead of submitting it.
 */
export function inputStillPending(rows: readonly string[], sent: string): boolean {
  const box = promptInputText(rows);
  if (!box) return false;
  if (/^\[Pasted text/.test(box)) return true;
  const head = sent.trim().split('\n')[0].trim().slice(0, 24);
  return head.length > 0 && box.startsWith(head);
}

/** One screen cell: its text and whether it is painted faint (SGR 2). */
export interface ScreenCell {
  ch: string;
  dim: boolean;
}
export type ScreenRow = ScreenCell[];

/**
 * Viewport rows `start`..`end` with their faint attribute (the detector picks
 * the window). Blank rows are kept; wide characters take one cell.
 */
export function readScreenRows(term: XTerminal, start: number, end: number): ScreenRow[] {
  const buf = term.buffer.active;
  const cell = buf.getNullCell();
  const out: ScreenRow[] = [];
  for (let y = start; y <= end; y++) {
    const line = buf.getLine(buf.viewportY + y);
    if (!line) continue;
    const row: ScreenRow = [];
    for (let x = 0; x < line.length; x++) {
      line.getCell(x, cell);
      if (cell.getWidth() === 0) continue;
      row.push({ ch: cell.getChars() || ' ', dim: cell.isDim() !== 0 });
    }
    out.push(row);
  }
  return out;
}

/**
 * `rows` with the input box emptied: for a box that only holds a suggestion,
 * which is no typed text (inputStillPending would take it for some).
 */
export function clearPromptInput(rows: readonly string[]): string[] {
  const out = rows.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    const m = /^(\s*❯)/.exec(out[i]);
    if (!m) continue;
    out[i] = `${m[1]} `;
    break;
  }
  return out;
}

/** Claude Code's first-run placeholder: faint like a suggestion, but Tab does nothing with it. */
const PLACEHOLDER = /^Try ".*"$/;

const blank = (c: ScreenCell) => c.ch.trim() === '';

/**
 * The next prompt Claude Code suggests (F9): faint text in an otherwise empty
 * input box, `❯ commit it`, which Tab accepts there. Captured from Claude Code
 * 2.1.312: SGR 2 with the default colour, so plain grey text (a coloured
 * echo of an earlier prompt, typed input) never counts, nor does the
 * `Try "…"` placeholder. A suggestion that wraps continues on the faint rows
 * under the prompt. Undefined when the box holds input or isn't shown.
 */
export function promptSuggestion(rows: readonly ScreenRow[]): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    let k = 0;
    while (k < row.length && blank(row[k])) k++;
    if (row[k]?.ch !== '❯') continue;
    // The lowest prompt row is the input box; it alone decides.
    const lines = [row.slice(k + 1)];
    for (let j = i + 1; j < rows.length; j++) {
      const ink = rows[j].filter((c) => !blank(c));
      if (ink.length === 0 || ink.some((c) => !c.dim)) break;
      lines.push(rows[j]);
    }
    const ink = lines[0].filter((c) => !blank(c));
    if (ink.length === 0 || ink.some((c) => !c.dim)) return undefined;
    const text = lines
      .map((l) => l.map((c) => c.ch).join('').trim())
      .join(' ')
      .replace(/\s+/g, ' ');
    return PLACEHOLDER.test(text) ? undefined : text;
  }
  return undefined;
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/**
 * The pty bytes that type `text` into Claude's prompt, without the Enter.
 * Multi-line text goes in as a bracketed paste so its newlines stay newlines
 * instead of submitting the first line; CRLF/CR are normalized to LF.
 */
export function chatInputBytes(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  return normalized.includes('\n') ? PASTE_START + normalized + PASTE_END : normalized;
}
