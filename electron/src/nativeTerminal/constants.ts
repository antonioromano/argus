/**
 * Scrollback lines a native overlay keeps — the same depth as an xterm tile
 * (client/src/constants/terminal.ts; check:deps keeps them in sync). SwiftTerm
 * defaults to 500, which truncated the replay seed.
 */
export const TERMINAL_SCROLLBACK = 5000;
