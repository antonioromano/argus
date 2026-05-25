/** True when the renderer is running on macOS (Electron always is, but kept explicit). */
export const isMac =
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

/** Shortcut helper — Cmd on macOS, Ctrl elsewhere (mobile companion in a Linux/Windows browser). */
export function isPrimaryModifier(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

export type MenuChannel =
  | 'menu:new-session'
  | 'menu:close-session'
  | 'menu:open-settings'
  | 'menu:toggle-palette'
  | 'menu:toggle-theme';

export interface ElectronAppBridge {
  setBadge(count: number): void;
  onMenu(channel: MenuChannel, cb: () => void): () => void;
}

declare global {
  interface Window {
    electronApp?: ElectronAppBridge;
  }
}
