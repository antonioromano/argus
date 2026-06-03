/**
 * Single source of truth for the mobile keyboard's control-key encodings.
 *
 * Simple keys emit fixed escape bytes. Arrow keys are DECCKM-aware: claude/Ink
 * TUIs flip the terminal into application-cursor mode (ESC[?1h) and expect
 * `ESC O x` instead of `ESC [ x`, so arrow bytes are resolved at press time from
 * `terminal.modes.applicationCursorKeysMode`. Scroll keys never reach the pty —
 * the caller moves the xterm viewport directly via the shared terminal handle.
 */
export const KEY = {
  esc: '\x1b',
  tab: '\t',
  ctrlc: '\x03',
  ctrlr: '\x12',
  // DEL — delete the char before the cursor on the agent's input line.
  backspace: '\x7f',
  // Insert a line in claude's composer without submitting — desktop Shift+Enter.
  newline: '\x1b\r',
} as const;

export type SimpleKeyId = keyof typeof KEY;
export type ArrowKeyId = 'up' | 'down' | 'left' | 'right';
export type ScrollKeyId = 'top' | 'bottom';
export type KeyId = SimpleKeyId | ArrowKeyId | ScrollKeyId;

const ARROW_CODE: Record<ArrowKeyId, 'A' | 'B' | 'C' | 'D'> = { up: 'A', down: 'B', right: 'C', left: 'D' };

export function isArrow(id: KeyId): id is ArrowKeyId {
  return id === 'up' || id === 'down' || id === 'left' || id === 'right';
}

export function isScroll(id: KeyId): id is ScrollKeyId {
  return id === 'top' || id === 'bottom';
}

/** Arrow bytes, DECCKM-aware (application-cursor mode → `ESC O x`). */
export function arrow(id: ArrowKeyId, appCursor: boolean): string {
  const c = ARROW_CODE[id];
  return appCursor ? `\x1bO${c}` : `\x1b[${c}`;
}

/**
 * Submit payload for composed text. Each newline becomes ESC+CR (insert line,
 * like desktop Shift+Enter); a trailing CR submits the whole message.
 */
export function composeSubmit(text: string): string {
  return text.replace(/\n/g, KEY.newline) + '\r';
}
