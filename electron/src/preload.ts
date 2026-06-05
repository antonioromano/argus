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
});

contextBridge.exposeInMainWorld('electronNotifications', {
  show: (payload: { id: string; title: string; body: string; sound?: boolean }): void => {
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
