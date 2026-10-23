/**
 * The single source of truth for renderer keyboard shortcuts.
 *
 * Each action has a stable id (persisted as the key in AppConfig.keyboardShortcuts),
 * a default combo, and a category for grouping in the settings UI. `fixed` actions are
 * shown for discoverability but cannot be rebound (menu-owned or structurally reserved).
 */

export type ShortcutActionId =
  | 'new-session'
  | 'close-shell'
  | 'command-palette'
  | 'waiting-inbox'
  | 'session-search'
  | 'find-in-files'
  | 'open-settings'
  | 'open-diff'
  | 'open-files'
  | 'open-shell'
  | 'terminal-search'
  | 'clear-terminal'
  | 'terminal-newline';

export type ShortcutCategory = 'Sessions' | 'Navigation' | 'Explorer' | 'Terminal';

/** Where an action is live. Global actions go through the app-wide keydown
 *  handler; an `explorer` action only while a file explorer is open, where it
 *  takes precedence over a global action bound to the same combo. */
export type ShortcutScope = 'global' | 'explorer';

export interface ShortcutAction {
  id: ShortcutActionId;
  label: string;
  category: ShortcutCategory;
  defaultCombo: string;
  /** Fixed actions can't be rebound: close-shell is owned by the Electron menu accelerator,
   *  terminal-newline is a structural Claude Code convention. */
  fixed?: boolean;
  /** Optional note rendered beside the binding in settings. */
  note?: string;
  /** Defaults to 'global'. */
  scope?: ShortcutScope;
}

export const SHORTCUTS: readonly ShortcutAction[] = [
  { id: 'new-session', label: 'New session', category: 'Sessions', defaultCombo: 'mod+n' },
  { id: 'close-shell', label: 'Close active shell', category: 'Sessions', defaultCombo: 'mod+w', fixed: true, note: 'Set by the app menu' },
  { id: 'command-palette', label: 'Toggle Find & Jump', category: 'Navigation', defaultCombo: 'mod+k' },
  { id: 'waiting-inbox', label: 'Waiting inbox (every shell that needs you)', category: 'Navigation', defaultCombo: 'mod+shift+j' },
  // ⌘⇧F: Monaco binds ⌘F, ⌥⌘F and ⇧⌥F but not ⌘⇧F, so the menu accelerator
  // never fires over a focused editor's own command.
  { id: 'session-search', label: 'Search all sessions (scrollback + transcripts)', category: 'Navigation', defaultCombo: 'mod+shift+f' },
  { id: 'open-settings', label: 'Open settings', category: 'Navigation', defaultCombo: 'mod+,' },
  // Act on the focused shell — the tile whose terminal has focus in the mosaic,
  // or the open one in focus view. The ⋯ menu labels these from the same bindings.
  { id: 'open-diff', label: 'Diff for the focused shell', category: 'Navigation', defaultCombo: 'mod+d' },
  { id: 'open-files', label: 'Files for the focused shell', category: 'Navigation', defaultCombo: 'mod+e' },
  { id: 'open-shell', label: 'Terminal for the focused shell', category: 'Navigation', defaultCombo: 'mod+t' },
  // Shares ⌘⇧F with session-search on purpose (VS Code's Find in Files key): the
  // explorer claims it while open and the app-wide handler skips scoped actions.
  { id: 'find-in-files', label: 'Find in files', category: 'Explorer', defaultCombo: 'mod+shift+f', scope: 'explorer', note: 'While the file explorer is open' },
  { id: 'terminal-search', label: 'Search in active terminal', category: 'Terminal', defaultCombo: 'mod+f' },
  { id: 'clear-terminal', label: 'Clear scrollback (keeps the current screen)', category: 'Terminal', defaultCombo: 'mod+l' },
  { id: 'terminal-newline', label: 'Insert newline (multi-line prompt)', category: 'Terminal', defaultCombo: 'shift+enter', fixed: true },
];

export const SHORTCUTS_BY_ID: Record<ShortcutActionId, ShortcutAction> = Object.fromEntries(
  SHORTCUTS.map((s) => [s.id, s]),
) as Record<ShortcutActionId, ShortcutAction>;

export const CATEGORY_ORDER: ShortcutCategory[] = ['Sessions', 'Navigation', 'Explorer', 'Terminal'];

export const scopeOf = (a: ShortcutAction): ShortcutScope => a.scope ?? 'global';
