// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, webUtils, ipcRenderer } = require('electron') as typeof import('electron');

// Map filename → absolute path, populated on each drop event.
// Preload runs in the privileged context where Electron exposes file.path.
const pathMap = new Map<string, string>();

document.addEventListener(
  'drop',
  (e) => {
    pathMap.clear();
    if (!e.dataTransfer?.files) return;
    for (const file of Array.from(e.dataTransfer.files)) {
      const fullPath = webUtils.getPathForFile(file);
      if (fullPath) pathMap.set(file.name, fullPath);
    }
  },
  { capture: true },
);

// Same for files picked through an <input type="file"> (the Chat view's "+").
document.addEventListener(
  'change',
  (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files) return;
    pathMap.clear();
    for (const file of Array.from(input.files)) {
      const fullPath = webUtils.getPathForFile(file);
      if (fullPath) pathMap.set(file.name, fullPath);
    }
  },
  { capture: true },
);

contextBridge.exposeInMainWorld('electronFiles', {
  getPath: (name: string): string | undefined => pathMap.get(name),
});

contextBridge.exposeInMainWorld('electronDialog', {
  showMessageBox: (opts: Electron.MessageBoxOptions) =>
    ipcRenderer.invoke('dialog:showMessageBox', opts),
});

// App-level IPC bridge: menu commands main → renderer; Dock badge renderer → main.
//
// Every renderer-run menu item arrives as ONE `menu:command` message carrying
// its id; the list of ids lives only in electron/src/menuModel.ts. This
// sandboxed preload cannot import that module, so it checks the id's shape
// only (the same pattern as isMenuCommandId in ipcGuards.ts) and the renderer
// dispatches through its own typed handler map.
const MENU_ID = /^menu:[a-z]+(-[a-z]+)*$/;

contextBridge.exposeInMainWorld('electronApp', {
  setBadge: (count: number) => {
    ipcRenderer.send('dock:setBadge', count);
  },
  onMenuCommand: (cb: (id: string) => void): (() => void) => {
    const listener = (_e: unknown, id: unknown) => {
      if (typeof id === 'string' && id.length <= 64 && MENU_ID.test(id)) cb(id);
    };
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.off('menu:command', listener);
  },
  // The menu's commands with their live accelerators (menuModel.ts).
  describeMenu: () => ipcRenderer.invoke('menu:describe'),
  // Run a main-owned menu command; main drops anything off its allowlist.
  invokeMenu: (id: string) => {
    ipcRenderer.send('menu:invoke', id);
  },
  relaunch: () => {
    ipcRenderer.send('app:relaunch');
  },
  // Renderer -> main: is a Monaco editor currently focused? Lets main disable
  // the four menu accelerators that collide with Monaco's own default
  // keybindings (Cmd+D/E/F/L) while the keystroke needs to reach Monaco
  // instead of the menu — see electron/src/menuAcceleratorGating.ts.
  setEditorFocused: (focused: boolean) => {
    ipcRenderer.send('editor-focus:changed', focused);
  },
  // Renderer -> main: the resolved keyboard bindings, so the app-menu
  // accelerators that mirror them follow a rebind. Those accelerators are the
  // only way the shortcut reaches a native terminal tile, whose child NSWindow
  // takes key focus away from the renderer — see electron/src/menuShortcuts.ts.
  setMenuShortcuts: (shortcuts: Record<string, string>) => {
    ipcRenderer.send('menu:set-shortcuts', shortcuts);
  },
});

// macOS appearance (plan 008): material, contrast, active window, system
// accent. `snapshot` is synchronous so the first paint already carries the
// right attributes; main validates the sender and the theme value.
contextBridge.exposeInMainWorld('electronAppearance', {
  snapshot: (): unknown => {
    try { return ipcRenderer.sendSync('appearance:snapshot') ?? undefined; } catch { return undefined; }
  },
  onChange: (cb: (snapshot: unknown) => void): (() => void) => {
    const listener = (_e: unknown, snapshot: unknown) => cb(snapshot);
    ipcRenderer.on('appearance:changed', listener);
    return () => ipcRenderer.off('appearance:changed', listener);
  },
  setTheme: (mode: 'dark' | 'light' | 'system') => {
    ipcRenderer.send('appearance:set-theme', mode);
  },
  // The toolbar height (density); main re-centres the traffic lights on it.
  setTitlebarHeight: (px: number) => {
    ipcRenderer.send('appearance:titlebar-height', px);
  },
});

contextBridge.exposeInMainWorld('electronShell', {
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
});

// Settings export / import (plan 007). The renderer hands over text only; main
// owns every path (save/open dialogs, the userData backup folder).
contextBridge.exposeInMainWorld('electronSettings', {
  saveFile: (text: string) => ipcRenderer.invoke('settings:save-file', text),
  openFile: () => ipcRenderer.invoke('settings:open-file'),
  backup: (text: string) => ipcRenderer.invoke('settings:backup', text),
  reveal: (which: 'export' | 'backup') => ipcRenderer.invoke('settings:reveal', which),
});

// Help surfaces (plan 002). The diagnostics text never crosses this bridge:
// main writes it to the clipboard and answers { ok } only.
contextBridge.exposeInMainWorld('electronHelp', {
  appInfo: () => ipcRenderer.invoke('help:app-info'),
  copyDiagnostics: () => ipcRenderer.invoke('help:copy-diagnostics'),
  reportIssue: () => ipcRenderer.invoke('help:report-issue'),
});

// Native terminal overlay bridge. A
// new flat namespace, matching the existing electronFiles / electronDialog /
// electronApp convention — there is no `window.argus` object in this codebase.
interface NativeTerminalRect { x: number; y: number; width: number; height: number }
interface NativeTerminalTheme { background: string; foreground: string; cursor: string; ansi: string[] }

contextBridge.exposeInMainWorld('electronNativeTerminal', {
  available: (): Promise<boolean> => ipcRenderer.invoke('native-term:available'),
  attach: (sessionId: string, rect: NativeTerminalRect, fontSize?: number): Promise<boolean> =>
    ipcRenderer.invoke('native-term:attach', { sessionId, rect, fontSize }),
  setRect: (sessionId: string, rect: NativeTerminalRect): void => {
    ipcRenderer.send('native-term:rect', { sessionId, rect });
  },
  setTheme: (sessionId: string, theme: NativeTerminalTheme): void => {
    ipcRenderer.send('native-term:set-theme', { sessionId, theme });
  },
  setDimmed: (sessionId: string, dimmed: boolean, isDark: boolean): void => {
    ipcRenderer.send('native-term:set-dimmed', { sessionId, dimmed, isDark });
  },
  detach: (sessionId: string): void => {
    ipcRenderer.send('native-term:detach', { sessionId });
  },
  suppress: (sessionId: string): void => {
    ipcRenderer.send('native-term:suppress', { sessionId });
  },
  unsuppress: (sessionId: string): void => {
    ipcRenderer.send('native-term:unsuppress', { sessionId });
  },
  // Opens/closes SwiftTerm's OWN find bar (see task-6's reversal) — no search
  // term crosses this bridge; the bar itself owns typing/next/prev/options.
  openFindBar: (sessionId: string): void => {
    ipcRenderer.send('native-term:open-find-bar', { sessionId });
  },
  closeFindBar: (sessionId: string): void => {
    ipcRenderer.send('native-term:close-find-bar', { sessionId });
  },
  focusTerminal: (sessionId: string): void => {
    ipcRenderer.send('native-term:focus', { sessionId });
  },
  setResizeSuspended: (sessionId: string, suspended: boolean): void => {
    ipcRenderer.send('native-term:set-resize-suspended', { sessionId, suspended });
  },
  setFontSize: (sessionId: string, px: number): void => {
    ipcRenderer.send('native-term:set-font-size', { sessionId, px });
  },
  clearScrollback: (sessionId: string): void => {
    ipcRenderer.send('native-term:clear-scrollback', { sessionId });
  },
  /**
   * Subscribes to key-window transitions on native overlays. A click on a
   * native tile lands in the child NSWindow and never reaches the web
   * contents, so this is the renderer's ONLY way to learn that a native tile
   * is the focused one — which is what every "for the focused shell" command
   * (Cmd+T/D/E/L, and the tile focus ring) reads.
   */
  /** Terminal bell on a native terminal; the renderer flashes the tile. */
  onBell: (cb: (sessionId: string) => void): (() => void) => {
    const listener = (_e: unknown, payload: { sessionId: string }) => cb(payload.sessionId);
    ipcRenderer.on('native-term:bell', listener);
    return () => ipcRenderer.off('native-term:bell', listener);
  },
  /** File paths dropped onto a native terminal; the renderer formats and sends them. */
  onDropPaths: (cb: (sessionId: string, paths: string[]) => void): (() => void) => {
    const listener = (_e: unknown, payload: { sessionId: string; paths: string[] }) =>
      cb(payload.sessionId, payload.paths);
    ipcRenderer.on('native-term:drop-paths', listener);
    return () => ipcRenderer.off('native-term:drop-paths', listener);
  },
  onFocus: (cb: (sessionId: string, focused: boolean) => void): (() => void) => {
    const listener = (_e: unknown, payload: { sessionId: string; focused: boolean }) =>
      cb(payload.sessionId, payload.focused);
    ipcRenderer.on('native-term:focus', listener);
    return () => ipcRenderer.off('native-term:focus', listener);
  },
  onCopy: (cb: (sessionId: string, text: string) => void): (() => void) => {
    const listener = (_e: unknown, payload: { sessionId: string; text: string }) =>
      cb(payload.sessionId, payload.text);
    ipcRenderer.on('native-term:copy', listener);
    return () => ipcRenderer.off('native-term:copy', listener);
  },
  writeClipboard: (text: string, html?: string): void => {
    ipcRenderer.send('native-term:write-clipboard', { text, html });
  },
});

contextBridge.exposeInMainWorld('electronNotifications', {
  show: (payload: { id: string; title: string; subtitle?: string; body: string; sound?: boolean; attributeToApp?: boolean }): void => {
    ipcRenderer.send('notif:show', payload);
  },
  close: (id: string): void => {
    ipcRenderer.send('notif:close', id);
  },
  /** Open a macOS System Settings pane by key; main maps it to a fixed URL. */
  openSystemSettings: (pane: 'notifications'): void => {
    ipcRenderer.send('system:openSettings', pane);
  },
  onClick: (cb: (id: string) => void): (() => void) => {
    const listener = (_e: unknown, id: string) => cb(id);
    ipcRenderer.on('notif:click', listener);
    return () => ipcRenderer.off('notif:click', listener);
  },
});

// Deep-link launch approvals. Approval/launcher writes are validated in main
// (sender must be a focused Argus window's main frame).
contextBridge.exposeInMainWorld('electronLaunch', {
  // Read once at preload time; main answers synchronously with its SCHEME const.
  scheme: (() => { try { const s = ipcRenderer.sendSync('launch:scheme'); return typeof s === 'string' ? s : undefined; } catch { return undefined; } })(),
  list: () => ipcRenderer.invoke('launch:list'),
  approve: (id: string, saveAs?: { id: string; label: string; overwrite?: boolean }) => ipcRenderer.invoke('launch:approve', { id, saveAs }),
  discard: (id: string) => ipcRenderer.invoke('launch:discard', id),
  onChanged: (cb: () => void) => {
    const l = () => cb();
    ipcRenderer.on('launch:changed', l);
    return () => ipcRenderer.off('launch:changed', l);
  },
  onToast: (cb: (t: { message: string; tone: 'ok' | 'warn' | 'danger' }) => void) => {
    const l = (_e: unknown, t: { message: string; tone: 'ok' | 'warn' | 'danger' }) => cb(t);
    ipcRenderer.on('launch:toast', l);
    return () => ipcRenderer.off('launch:toast', l);
  },
  launchers: {
    list: () => ipcRenderer.invoke('launcher:list'),
    rename: (id: string, label: string) => ipcRenderer.invoke('launcher:rename', { id, label }),
    remove: (id: string) => ipcRenderer.invoke('launcher:delete', id),
    // Settings import (plan 007): main re-validates each request on this Mac.
    import: (items: unknown[]) => ipcRenderer.invoke('launcher:import', items),
  },
});
