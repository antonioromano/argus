import type { MenuCommandWire } from '@argus/shared';

/**
 * Renderer side of the app-menu IPC (see electron/src/menuModel.ts).
 *
 * Main sends every renderer-run menu item as one `menu:command` message
 * carrying its id; there is no per-item channel and no renderer-side list of
 * them. Outside Electron (the mobile companion, dev:web) every call is a no-op.
 */

/** Subscribe to every renderer-run menu command. Returns the unsubscribe. */
export function onMenuCommand(cb: (id: string) => void): () => void {
  return window.electronApp?.onMenuCommand?.(cb) ?? (() => {});
}

let described: Promise<MenuCommandWire[]> | null = null;

/** The app menu's commands with their live accelerators. Asked once per window. */
export function describeMenu(): Promise<MenuCommandWire[]> {
  const bridge = window.electronApp;
  if (!bridge?.describeMenu) return Promise.resolve([]);
  described ??= bridge.describeMenu().catch(() => {
    described = null; // let a later call retry
    return [];
  });
  return described;
}

/** Run a main-owned menu command (New Window, Reload, Zoom…). Main ignores any other id. */
export function invokeMenu(id: string): void {
  window.electronApp?.invokeMenu?.(id);
}

/** Tests only: forget the cached describe answer. */
export function resetMenuBridgeForTests(): void {
  described = null;
}
