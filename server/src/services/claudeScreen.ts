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
