import type { Terminal } from '@xterm/xterm';
import type { ISearchOptions, SearchAddon } from '@xterm/addon-search';

/**
 * "Scroll this session's terminal to a search hit" (F9). The request is parked
 * per session, because the jump usually mounts the terminal first: a terminal
 * already on screen takes it from the event, a fresh one once its join replay
 * has painted.
 */
export interface TerminalRevealRequest {
  query: string;
  /** Buffer row the matching line starts on, when the server knew it. */
  line?: number;
}

export const TERMINAL_REVEAL_EVENT = 'argus:terminal-reveal';

const pending = new Map<string, TerminalRevealRequest>();

export function requestTerminalReveal(sessionId: string, req: TerminalRevealRequest): void {
  pending.set(sessionId, req);
  window.dispatchEvent(new CustomEvent(TERMINAL_REVEAL_EVENT, { detail: { sessionId } }));
}

/** Take (and clear) the parked request for this session, if any. */
export function takeTerminalReveal(sessionId: string): TerminalRevealRequest | undefined {
  const req = pending.get(sessionId);
  pending.delete(sessionId);
  return req;
}

/**
 * Select and scroll to the match with the terminal's own SearchAddon. With a
 * row: search forward from that row, which lands on the hit itself. Without
 * one (a sleeping session, searched from its stored frame): the newest match.
 */
export function applyTerminalReveal(terminal: Pick<Terminal, 'select' | 'clearSelection' | 'buffer'>, addon: Pick<SearchAddon, 'findNext' | 'findPrevious'>, req: TerminalRevealRequest): boolean {
  // No decorations: the selection marks the hit, and nothing lingers after.
  const opts: ISearchOptions = { caseSensitive: false, regex: false };
  const rows = terminal.buffer.active.length;
  if (req.line !== undefined && req.line >= 0 && req.line < rows) {
    terminal.select(0, req.line, 0);
    return addon.findNext(req.query, { ...opts, incremental: true });
  }
  terminal.clearSelection();
  return addon.findPrevious(req.query, opts);
}
