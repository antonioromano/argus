import type { TerminalEngine } from '@argus/shared';

/**
 * Every user-facing string about the terminal engine. One module so the
 * update sheet and badges cannot describe it differently. The choice the user
 * makes at creation lives in terminalKind.ts (Universal / Advanced / Native).
 *
 * The stored VALUES are still 'web' and 'native' — they are persisted in
 * config.json and on every session record, so renaming them would orphan
 * existing data. Only the labels changed.
 */

/** Short form, for badges and inline references where the platform is implied. */
export const ENGINE_SHORT: Record<TerminalEngine, string> = {
  web: 'Universal',
  native: 'Advanced',
};

/**
 * The one engine-specific risk in an update. The session and its scrollback are
 * untouched either way — the addon only decides how a tile is drawn, never how
 * the agent runs (terminalEngine never reaches the pty layer).
 */
export const ENGINE_NOTE_UPDATE =
  'These render as Universal if the new version’s native component fails to load. '
  + 'The shell and its history are unaffected — only how it is drawn.';
