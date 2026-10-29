/**
 * The native app menu as data: every command item (id, label, section, where
 * it runs, its accelerator) plus the layout that places them between roles and
 * separators. main.ts's buildAppMenu is a mapping over MENU_LAYOUT, and
 * `menu:describe` hands the renderer the same list, so the menu has one
 * definition instead of a copy in main, the preload and the client.
 *
 * Kept pure on purpose (only type imports, plus menuShortcuts.ts which is pure
 * too): the client imports this file from its tests to check that every
 * renderer command has a handler. menuModel.test.ts fails if an import of the
 * Electron module ever creeps in.
 *
 * `runIn: 'renderer'` items are sent to the focused window as one
 * `menu:command` IPC message carrying the id. `runIn: 'main'` items are handled
 * in main (MAIN_HANDLERS in main.ts); the renderer can ask for one through
 * `menu:invoke`, which only accepts ids that pass isMainCommandId.
 */
import type { MenuCommandRunIn, MenuCommandWire, MenuSection } from '@argus/shared';
import { menuAccelerator, type MenuShortcutId } from './menuShortcuts.js';

export interface MenuCommandDef {
  id: string;
  label: string;
  section: MenuSection;
  runIn: MenuCommandRunIn;
  /** Follows the user's binding for this shortcut (see menuShortcuts.ts). */
  shortcut?: MenuShortcutId;
  /** A fixed Electron accelerator, for items with no rebindable shortcut. */
  accelerator?: string;
  /** Why this item is left out of the command palette; absent = included. */
  paletteExclude?: string;
  keywords?: string;
}

const DEFS = [
  // App
  { id: 'menu:open-settings', label: 'Settings…', section: 'App', runIn: 'renderer', shortcut: 'open-settings', keywords: 'preferences' },
  { id: 'menu:quit-stop-all', label: 'Quit & Stop All Sessions', section: 'App', runIn: 'main', accelerator: 'CmdOrCtrl+Shift+Q' },

  // File
  { id: 'menu:new-window', label: 'New Window', section: 'File', runIn: 'main', accelerator: 'CmdOrCtrl+Shift+N' },
  { id: 'menu:new-session', label: 'New Session…', section: 'File', runIn: 'renderer', shortcut: 'new-session' },
  { id: 'menu:close-session', label: 'Close Session', section: 'File', runIn: 'renderer', shortcut: 'close-shell' },
  { id: 'menu:review-launch', label: 'Review Pending Launch…', section: 'File', runIn: 'renderer', accelerator: 'Alt+CmdOrCtrl+L' },

  // View
  { id: 'menu:toggle-palette', label: 'Find & Jump…', section: 'View', runIn: 'renderer', shortcut: 'command-palette' },
  { id: 'menu:waiting-inbox', label: 'Waiting Inbox', section: 'View', runIn: 'renderer', shortcut: 'waiting-inbox' },
  { id: 'menu:session-search', label: 'Search All Sessions…', section: 'View', runIn: 'renderer', shortcut: 'session-search' },
  // Label follows the current appearance (menuCommandLabel): it names what
  // the item does, not "Toggle Theme".
  { id: 'menu:toggle-theme', label: 'Use Light Appearance', section: 'View', runIn: 'renderer', shortcut: 'toggle-theme', keywords: 'theme dark light toggle' },
  // These five were renderer-only keydown handlers. A native terminal overlay
  // is a child NSWindow that takes key focus, so the renderer never sees their
  // keydown; as app-menu accelerators they fire regardless of which view has
  // focus. Their accelerators come from menuShortcuts.ts, which the renderer
  // keeps in sync with the resolved bindings, so a rebind in Settings moves
  // them too. A binding the menu cannot express (no Cmd/Ctrl/Alt) falls back
  // to its default here; the renderer keydown path still honours it (web
  // tiles only). Four of them collide with Monaco defaults and are gated
  // while an editor has focus: see menuAcceleratorGating.ts.
  { id: 'menu:open-diff', label: 'Diff for Focused Shell', section: 'View', runIn: 'renderer', shortcut: 'open-diff' },
  { id: 'menu:open-files', label: 'Files for Focused Shell', section: 'View', runIn: 'renderer', shortcut: 'open-files' },
  { id: 'menu:open-shell', label: 'Terminal for Focused Shell', section: 'View', runIn: 'renderer', shortcut: 'open-shell' },
  { id: 'menu:terminal-search', label: 'Search in Terminal…', section: 'View', runIn: 'renderer', shortcut: 'terminal-search' },
  { id: 'menu:clear-terminal', label: 'Clear Scrollback', section: 'View', runIn: 'renderer', shortcut: 'clear-terminal' },
  // Not the built-in reload roles: those reload BrowserWindow.getFocusedWindow(),
  // which is null while a native tile (a child NSWindow) is key, so Cmd+R did
  // nothing there. main resolves the target through getFocusedWindowId(),
  // which also maps the overlay to its owner (see menuTarget.ts).
  { id: 'menu:reload', label: 'Reload', section: 'View', runIn: 'main', accelerator: 'CmdOrCtrl+R' },
  { id: 'menu:force-reload', label: 'Force Reload', section: 'View', runIn: 'main', accelerator: 'Shift+CmdOrCtrl+R' },
  // Whole-app browser zoom (scales terminals, Monaco and UI uniformly). Not the
  // built-in roles, so every change routes through setZoomLevel and keeps the
  // tracked level in sync (survives reload).
  { id: 'menu:actual-size', label: 'Actual Size', section: 'View', runIn: 'main', accelerator: 'CmdOrCtrl+0' },
  { id: 'menu:zoom-in', label: 'Zoom In', section: 'View', runIn: 'main', accelerator: 'CmdOrCtrl+Plus' },
  { id: 'menu:zoom-out', label: 'Zoom Out', section: 'View', runIn: 'main', accelerator: 'CmdOrCtrl+-' },

  // Window
  { id: 'menu:merge-windows', label: 'Merge All Windows', section: 'Window', runIn: 'main' },

  // Help
  { id: 'menu:whats-new', label: 'What’s New…', section: 'Help', runIn: 'renderer', keywords: 'changelog release notes' },
  { id: 'menu:github', label: 'Argus on GitHub', section: 'Help', runIn: 'main' },
] as const satisfies readonly MenuCommandDef[];

type Def = (typeof DEFS)[number];
export type MenuCommandId = Def['id'];
export type MainCommandId = Extract<Def, { runIn: 'main' }>['id'];
export type RendererCommandId = Extract<Def, { runIn: 'renderer' }>['id'];

export const MENU_COMMANDS: readonly MenuCommandDef[] = DEFS;

export const MAIN_COMMAND_IDS = DEFS
  .filter((d) => d.runIn === 'main')
  .map((d) => d.id) as readonly MainCommandId[];

export const RENDERER_COMMAND_IDS = DEFS
  .filter((d) => d.runIn === 'renderer')
  .map((d) => d.id) as readonly RendererCommandId[];

const MAIN_ID_SET: ReadonlySet<string> = new Set(MAIN_COMMAND_IDS);

/** The `menu:invoke` allowlist: only main-run commands, nothing else. */
export function isMainCommandId(v: unknown): v is MainCommandId {
  return typeof v === 'string' && MAIN_ID_SET.has(v);
}

/** Built-in Electron menu roles used in the layout (a subset of Electron's union). */
export type MenuRole =
  | 'about' | 'services' | 'hide' | 'hideOthers' | 'unhide' | 'quit'
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'pasteAndMatchStyle' | 'delete' | 'selectAll'
  | 'togglefullscreen' | 'minimize' | 'zoom' | 'front';

export type MenuLayoutItem = MenuCommandId | 'separator' | { role: MenuRole };

export interface MenuLayoutMenu {
  section: MenuSection | 'Edit';
  label: string;
  /** Top-level role (macOS gives the Help menu its search field). */
  role?: 'help';
  /** Only the macOS application menu. */
  macOnly?: boolean;
  items: readonly MenuLayoutItem[];
}

const SEP = 'separator' as const;

export const MENU_LAYOUT: readonly MenuLayoutMenu[] = [
  {
    section: 'App', label: 'Argus', macOnly: true,
    items: [
      { role: 'about' }, SEP,
      'menu:open-settings', SEP,
      { role: 'services' }, SEP,
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, SEP,
      { role: 'quit' }, // keep-alive: detaches, sessions keep running in the background
      'menu:quit-stop-all',
    ],
  },
  {
    section: 'File', label: 'File',
    items: ['menu:new-window', SEP, 'menu:new-session', 'menu:close-session', 'menu:review-launch'],
  },
  {
    section: 'Edit', label: 'Edit',
    items: [
      { role: 'undo' }, { role: 'redo' }, SEP,
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' },
      { role: 'delete' }, { role: 'selectAll' },
    ],
  },
  {
    section: 'View', label: 'View',
    items: [
      'menu:toggle-palette', 'menu:waiting-inbox', 'menu:session-search', SEP,
      'menu:toggle-theme', SEP,
      'menu:open-diff', 'menu:open-files', 'menu:open-shell', 'menu:terminal-search', 'menu:clear-terminal', SEP,
      'menu:reload', 'menu:force-reload', SEP,
      'menu:actual-size', 'menu:zoom-in', 'menu:zoom-out', SEP,
      { role: 'togglefullscreen' },
    ],
  },
  {
    section: 'Window', label: 'Window',
    items: [{ role: 'minimize' }, { role: 'zoom' }, SEP, 'menu:merge-windows', SEP, { role: 'front' }],
  },
  {
    section: 'Help', label: 'Help', role: 'help',
    items: ['menu:whats-new', SEP, 'menu:github'],
  },
];

const BY_ID: ReadonlyMap<string, MenuCommandDef> = new Map(MENU_COMMANDS.map((d) => [d.id, d]));

export function menuCommand(id: MenuCommandId): MenuCommandDef {
  return BY_ID.get(id)!;
}

// Whether Argus currently shows its dark appearance; set by main from the
// renderer's theme (appearanceHost) so View → Use Light/Dark Appearance names
// the switch it will make.
let darkAppearance = true;

/** Record the current appearance. True when the toggle-theme label changed. */
export function setMenuAppearance(dark: boolean): boolean {
  if (dark === darkAppearance) return false;
  darkAppearance = dark;
  return true;
}

/** The label to show right now (only the theme item is dynamic). */
export function menuCommandLabel(def: MenuCommandDef): string {
  if (def.id === 'menu:toggle-theme') return darkAppearance ? 'Use Light Appearance' : 'Use Dark Appearance';
  return def.label;
}

/** The accelerator to install right now: the live binding, the fixed one, or none. */
export function menuCommandAccelerator(def: MenuCommandDef): string | null {
  if (def.shortcut) return menuAccelerator(def.shortcut);
  return def.accelerator ?? null;
}

export function toWire(def: MenuCommandDef, accelerator: string | null): MenuCommandWire {
  const wire: MenuCommandWire = {
    id: def.id,
    label: menuCommandLabel(def),
    section: def.section,
    accelerator,
    runIn: def.runIn,
    palette: !def.paletteExclude,
  };
  if (def.keywords) wire.keywords = def.keywords;
  return wire;
}

/** What `menu:describe` answers: every command with its current accelerator. */
export function describeMenuCommands(): MenuCommandWire[] {
  return MENU_COMMANDS.map((d) => toWire(d, menuCommandAccelerator(d)));
}
