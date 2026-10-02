import { isMac } from '../utils/platform.js';

/**
 * macOS line-editing keys for the terminal, the way Terminal / iTerm ("Natural
 * text editing") do it. A terminal has no code for ⌘+key — xterm.js sends a
 * plain arrow (or nothing), so ⌘← never reached the start of Claude's input
 * line. Translate to the readline/emacs controls that Claude Code and zsh
 * already understand:
 *   ⌘←  → Ctrl-A (start of line)
 *   ⌘→  → Ctrl-E (end of line)
 *   ⌘⌫  → Ctrl-U (delete to start of line)
 * Returns the bytes to send, or null when the event isn't one of these.
 */
export function macLineEditSequence(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, mac: boolean = isMac): string | null {
  if (!mac || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  switch (e.key) {
    case 'ArrowLeft': return '\x01';
    case 'ArrowRight': return '\x05';
    case 'Backspace': return '\x15';
    default: return null;
  }
}
