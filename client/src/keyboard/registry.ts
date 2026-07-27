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
  | 'open-settings'
  | 'terminal-search'
  | 'clear-terminal'
  | 'terminal-newline';

export type ShortcutCategory = 'Sessions' | 'Navigation' | 'Terminal';

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
}

export const SHORTCUTS: readonly ShortcutAction[] = [
  { id: 'new-session', label: 'New session', category: 'Sessions', defaultCombo: 'mod+n' },
  { id: 'close-shell', label: 'Close active shell', category: 'Sessions', defaultCombo: 'mod+w', fixed: true, note: 'Set by the app menu' },
  { id: 'command-palette', label: 'Toggle Find & Jump', category: 'Navigation', defaultCombo: 'mod+k' },
  { id: 'open-settings', label: 'Open settings', category: 'Navigation', defaultCombo: 'mod+,' },
  { id: 'terminal-search', label: 'Search in active terminal', category: 'Terminal', defaultCombo: 'mod+f' },
  { id: 'clear-terminal', label: 'Clear scrollback (keeps the current screen)', category: 'Terminal', defaultCombo: 'mod+l' },
  { id: 'terminal-newline', label: 'Insert newline (multi-line prompt)', category: 'Terminal', defaultCombo: 'shift+enter', fixed: true },
];

export const SHORTCUTS_BY_ID: Record<ShortcutActionId, ShortcutAction> = Object.fromEntries(
  SHORTCUTS.map((s) => [s.id, s]),
) as Record<ShortcutActionId, ShortcutAction>;

export const CATEGORY_ORDER: ShortcutCategory[] = ['Sessions', 'Navigation', 'Terminal'];
