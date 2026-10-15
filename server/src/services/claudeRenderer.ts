import path from 'path';
import type { ClaudeRenderer } from '@argus/shared';

/**
 * The env that picks Claude Code's terminal renderer for a session Argus spawns.
 *
 * Claude's classic renderer writes the conversation into the terminal's main
 * scrollback, hard-wrapped to the pty width, and reprints it on every SIGWINCH.
 * Every width change in Argus (mosaic ↔ Focus, a window resize, a divider drag)
 * therefore leaves a stale copy behind that no emulator can reflow — the
 * duplicated-message bug that scrollbackDedup can only partly clean up. The
 * fullscreen renderer runs on the alternate screen with its own virtualized
 * history and redraws it for the new width, so nothing stale ever reaches the
 * terminal's scrollback.
 *
 * Applied per spawned process, so the user's own `tui` setting (and `claude` in
 * any other terminal) is left alone. Both vars were verified to win over a
 * `tui` value in ~/.claude/settings.json; DISABLE_ALTERNATE_SCREEN also wins
 * over NO_FLICKER inherited from the user's shell.
 */
export function claudeRendererEnv(
  command: string,
  renderer: ClaudeRenderer | undefined,
): Record<string, string> {
  if (!isClaudeCommand(command)) return {};
  switch (renderer ?? 'fullscreen') {
    case 'fullscreen': return { CLAUDE_CODE_NO_FLICKER: '1' };
    case 'classic': return { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1' };
    default: return {};
  }
}

/** The command's executable is `claude` — the built-in agent or a custom one
 *  that runs it by path or with extra arguments. */
function isClaudeCommand(command: string): boolean {
  const exe = command.trim().split(/\s+/)[0] ?? '';
  return path.basename(exe) === 'claude';
}
