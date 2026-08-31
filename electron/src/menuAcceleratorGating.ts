/**
 * Four of the five menu accelerators added to fix native-tile key delivery
 * (menu:open-diff / menu:open-files / menu:terminal-search / menu:clear-terminal
 * — CmdOrCtrl+D/E/F/L) collide with Monaco's OWN default keybindings:
 *
 *   - Cmd+D: editor.action.addSelectionToNextFindMatch (multi-cursor)
 *   - Cmd+E: editor.actions.findWithSelection (mac only)
 *   - Cmd+F: actions.find (find in file)
 *   - Cmd+L: expandLineSelection
 *
 * An ENABLED Electron menu accelerator wins the native key-equivalent race
 * before the keystroke ever reaches the web contents, so while an editor is
 * focused these four must be DISABLED — that lets the key fall through to
 * Monaco instead of the menu. menu:open-shell (Cmd+T) has no Monaco default
 * binding and is never gated.
 *
 * Verified against the bundled monaco-editor@0.55.1 source
 * (node_modules/monaco-editor/esm/vs/editor/contrib/{multicursor,find,lineSelection}/browser/*.js) —
 * see task-5-report.md's fix-round section for the exact registrations found.
 */
export const COLLIDING_MENU_CHANNELS = [
  'menu:open-diff',
  'menu:open-files',
  'menu:terminal-search',
  'menu:clear-terminal',
] as const;

export type CollidingMenuChannel = typeof COLLIDING_MENU_CHANNELS[number];

/**
 * Fail-safe by construction: only `=== true` disables. `undefined` — a
 * renderer that hasn't reported yet (cold start, before the first Monaco
 * mount), an older build that never wires the report, or a non-Electron
 * client that will never send one — resolves to enabled, same as `false`.
 * A renderer that never reports must not leave these accelerators
 * permanently dead; that would defeat the entire point of this task.
 */
export function shouldCollidingAcceleratorsBeEnabled(editorFocused: boolean | undefined): boolean {
  return editorFocused !== true;
}
