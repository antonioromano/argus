/**
 * Config-driven accelerators for the app-menu items that mirror renderer
 * shortcuts.
 *
 * Why main needs these at all: a native terminal overlay is a child NSWindow
 * that takes key focus, so the renderer's keydown handler never sees a
 * keystroke typed into a native tile. App-menu accelerators fire regardless of
 * which view has focus, which is what makes Cmd+D/E/T/F/L work there — see the
 * View-menu comment in main.ts.
 *
 * Those accelerators used to be hardcoded, so rebinding one in Settings left
 * the menu (and therefore native tiles) on the old key. This module keeps a
 * live copy of the resolved bindings, pushed from the renderer whenever config
 * changes, and converts them to Electron accelerator strings.
 *
 * The ids and defaults deliberately mirror client/src/keyboard/registry.ts.
 * They are duplicated rather than imported because main and the renderer are
 * separate builds; the tests below pin the defaults so a drift shows up as a
 * failure rather than a silently stale menu.
 */

export type MenuShortcutId =
  | 'new-session'
  | 'close-shell'
  | 'command-palette'
  | 'open-settings'
  | 'open-diff'
  | 'open-files'
  | 'open-shell'
  | 'terminal-search'
  | 'clear-terminal';

export const MENU_SHORTCUT_DEFAULTS: Record<MenuShortcutId, string> = {
  'new-session': 'mod+n',
  'close-shell': 'mod+w',
  'command-palette': 'mod+k',
  'open-settings': 'mod+,',
  'open-diff': 'mod+d',
  'open-files': 'mod+e',
  'open-shell': 'mod+t',
  'terminal-search': 'mod+f',
  'clear-terminal': 'mod+l',
};

const MENU_SHORTCUT_IDS = Object.keys(MENU_SHORTCUT_DEFAULTS) as MenuShortcutId[];

/** Keys Electron names differently from a DOM KeyboardEvent.key token. */
const NAMED_KEYS: Record<string, string> = {
  enter: 'Return',
  return: 'Return',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  escape: 'Escape',
  esc: 'Escape',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  plus: 'Plus',
};

/** Punctuation Electron accepts verbatim as an accelerator key. */
const LITERAL_KEYS = new Set([',', '.', '/', ';', "'", '[', ']', '\\', '`', '-', '=']);

function acceleratorKey(key: string): string | null {
  const k = key.toLowerCase();
  if (NAMED_KEYS[k]) return NAMED_KEYS[k];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(k)) return k.toUpperCase();
  if (/^[a-z0-9]$/.test(k)) return k.toUpperCase();
  if (LITERAL_KEYS.has(k)) return k;
  return null;
}

/**
 * Convert a stored combo ("mod+shift+f") into an Electron accelerator
 * ("CmdOrCtrl+Shift+F"), or null when it cannot safely become one.
 *
 * A combo with no Cmd/Ctrl/Alt is rejected on purpose. An app-menu accelerator
 * fires from anywhere in the app, so a bare (or shift-only) key would swallow
 * that character in every terminal — including the native tiles this whole
 * mechanism exists to serve. The renderer keydown path can still honour such a
 * binding; the menu will not carry it.
 */
export function comboToAccelerator(combo: string): string | null {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let mod = false;
  let alt = false;
  let shift = false;
  let key = '';
  for (const p of parts) {
    if (p === 'mod' || p === 'cmd' || p === 'meta' || p === 'ctrl' || p === 'control') mod = true;
    else if (p === 'alt' || p === 'option') alt = true;
    else if (p === 'shift') shift = true;
    else if (key) return null; // two non-modifier tokens: not a combo we understand
    else key = p;
  }
  if (!key || (!mod && !alt)) return null;

  const eKey = acceleratorKey(key);
  if (!eKey) return null;

  const tokens: string[] = [];
  if (mod) tokens.push('CmdOrCtrl');
  if (alt) tokens.push('Alt');
  if (shift) tokens.push('Shift');
  tokens.push(eKey);
  return tokens.join('+');
}

const current: Record<MenuShortcutId, string> = { ...MENU_SHORTCUT_DEFAULTS };

/**
 * Accelerator to put on a menu item. Always a valid accelerator: an id bound
 * to something the menu cannot express falls back to its default, so the item
 * keeps a working key rather than losing its accelerator entirely.
 */
export function menuAccelerator(id: MenuShortcutId): string {
  return comboToAccelerator(current[id])
    ?? comboToAccelerator(MENU_SHORTCUT_DEFAULTS[id])!;
}

/**
 * Apply resolved bindings pushed from the renderer. Unknown ids are ignored;
 * an id whose combo is missing or unusable reverts to its default.
 *
 * Returns true when anything actually changed — the caller rebuilds the
 * application menu only then, since rebuilding tears down and recreates every
 * NSMenuItem (and with it the gating state applyMenuAcceleratorGating owns).
 */
export function setMenuShortcuts(next: Partial<Record<string, string>>): boolean {
  let changed = false;
  for (const id of MENU_SHORTCUT_IDS) {
    const raw = next[id];
    const combo = raw && comboToAccelerator(raw) ? raw : MENU_SHORTCUT_DEFAULTS[id];
    if (current[id] !== combo) {
      current[id] = combo;
      changed = true;
    }
  }
  return changed;
}

/** Current bindings, for tests and diagnostics. */
export function getMenuShortcuts(): Record<MenuShortcutId, string> {
  return { ...current };
}
