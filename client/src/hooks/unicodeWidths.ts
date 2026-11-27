import type { Terminal } from '@xterm/xterm';
import { Unicode11Addon } from '@xterm/addon-unicode11';

/**
 * Switch a terminal to Unicode 11 character widths. xterm defaults to its
 * Unicode 6 table, which gives emoji like 👉 / ✅ one column while the agent
 * (string-width), the server's TerminalMirror and SwiftTerm give them two —
 * text after an emoji then lands a column off and tables garble.
 */
export function enableUnicode11(terminal: Terminal): void {
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
}
