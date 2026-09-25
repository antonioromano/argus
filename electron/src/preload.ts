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

contextBridge.exposeInMainWorld('electronFiles', {
  getPath: (name: string): string | undefined => pathMap.get(name),
});

contextBridge.exposeInMainWorld('electronDialog', {
  showMessageBox: (opts: Electron.MessageBoxOptions) =>
    ipcRenderer.invoke('dialog:showMessageBox', opts),
});

// App-level IPC bridge: menu events main → renderer; Dock badge renderer → main.
const MENU_CHANNELS = [
  'menu:new-session',
  'menu:close-session',
  'menu:open-settings',
  'menu:toggle-palette',
  'menu:toggle-theme',
  'menu:open-diff',
  'menu:open-files',
  'menu:open-shell',
  'menu:terminal-search',
  'menu:clear-terminal',
] as const;
type MenuChannel = typeof MENU_CHANNELS[number];

contextBridge.exposeInMainWorld('electronApp', {
  setBadge: (count: number) => {
    ipcRenderer.send('dock:setBadge', count);
  },
  onMenu: (channel: MenuChannel, cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
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

contextBridge.exposeInMainWorld('electronShell', {
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
});

// Native terminal overlay bridge. A
// new flat namespace, matching the existing electronFiles / electronDialog /
// electronApp convention — there is no `window.argus` object in this codebase.
interface NativeTerminalRect { x: number; y: number; width: number; height: number }
interface NativeTerminalTheme { background: string; foreground: string; cursor: string; ansi: string[] }

contextBridge.exposeInMainWorld('electronNativeTerminal', {
  available: (): Promise<boolean> => ipcRenderer.invoke('native-term:available'),
  attach: (sessionId: string, rect: NativeTerminalRect): Promise<boolean> =>
    ipcRenderer.invoke('native-term:attach', { sessionId, rect }),
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
});

contextBridge.exposeInMainWorld('electronNotifications', {
  show: (payload: { id: string; title: string; subtitle?: string; body: string; sound?: boolean; attributeToApp?: boolean }): void => {
    ipcRenderer.send('notif:show', payload);
  },
  close: (id: string): void => {
    ipcRenderer.send('notif:close', id);
  },
  onClick: (cb: (id: string) => void): (() => void) => {
    const listener = (_e: unknown, id: string) => cb(id);
    ipcRenderer.on('notif:click', listener);
    return () => ipcRenderer.off('notif:click', listener);
  },
});
