import type { Terminal } from '@xterm/xterm';

// DECSET/DECRST private modes for mouse tracking + extended encodings.
// Argus drops mouse reporting entirely so plain click-drag does native text
// selection instead of being captured as mouse events by the inner app (Claude
// Code enables these). Scrollback is local to xterm and Claude is keyboard-
// navigable, so nothing depends on these modes.
//
// Deliberately NOT included: 1004 (focus reporting — harmless, used by Claude),
// 1049/47/1047 (alt-screen — needed by vim/less), 2004 (bracketed paste), 25
// (cursor visibility).
const MOUSE_MODES = new Set([1000, 1001, 1002, 1003, 1005, 1006, 1015, 1016]);

// Swallow the sequence only when every param is a mouse mode. Returning false
// (the param set mixes in a non-mouse mode, or is empty) lets xterm's default
// handler run, preserving all other private modes.
function isMouseModeSet(params: (number | number[])[]): boolean {
  if (params.length === 0) return false;
  for (const p of params) {
    const mode = Array.isArray(p) ? p[0] : p;
    if (!MOUSE_MODES.has(mode)) return false;
  }
  return true;
}

/**
 * Prevent the terminal from ever entering mouse-reporting mode by swallowing
 * the mouse-related DECSET (`CSI ? Pm h`) / DECRST (`CSI ? Pm l`) sequences at
 * the parser level. Parser-level handling is chunk-safe — xterm reassembles
 * split escape sequences internally before invoking the handler.
 */
export function disableMouseReporting(terminal: Terminal): void {
  terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, isMouseModeSet);
  terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, isMouseModeSet);
}
