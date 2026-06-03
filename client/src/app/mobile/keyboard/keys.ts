import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Single source of truth for the mobile keyboard's control-key encodings.
 *
 * PTY keys emit raw escape bytes to the session (same path as desktop xterm).
 * Scroll keys are local-only: they move the xterm viewport via a window event
 * and never reach the agent. Sequences confirmed against xterm defaults and the
 * existing usages in useTerminal.ts (Shift+Enter → `\x1b\r`) and the old ActionBar.
 */
const PTY_KEYS = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  tab: '\t',
  esc: '\x1b',
  ctrlc: '\x03',
  ctrlr: '\x12',
  // DEL — delete the char before the cursor on the agent's input line.
  backspace: '\x7f',
  // Insert a line in Claude's composer without submitting — matches desktop Shift+Enter.
  newline: '\x1b\r',
} as const;

export type PtyKeyId = keyof typeof PTY_KEYS;
export type ScrollKeyId = 'top' | 'bottom';
export type KeyId = PtyKeyId | ScrollKeyId;

export function isScrollKey(id: KeyId): id is ScrollKeyId {
  return id === 'top' || id === 'bottom';
}

/** Escape string for a PTY control key; `null` for local-only scroll keys. */
export function encode(id: KeyId): string | null {
  return isScrollKey(id) ? null : PTY_KEYS[id];
}

/**
 * Submit payload for composed text. Each newline becomes ESC+CR (insert line,
 * like desktop Shift+Enter); a trailing CR submits the whole message.
 */
export function composeSubmit(text: string): string {
  return text.replace(/\n/g, '\x1b\r') + '\r';
}

/**
 * Route a key press. PTY keys emit to the session; scroll keys fire a
 * sessionId-scoped `terminal:scroll` window event consumed by useTerminal.
 */
export function dispatchKey(id: KeyId, ctx: { sessionId: string; socket: TypedSocket }): void {
  if (isScrollKey(id)) {
    window.dispatchEvent(
      new CustomEvent('terminal:scroll', { detail: { sessionId: ctx.sessionId, dir: id } }),
    );
    return;
  }
  ctx.socket.emit('session:input', { sessionId: ctx.sessionId, data: PTY_KEYS[id] });
}
