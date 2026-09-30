import type { Launcher, LaunchActionResult, PendingLaunchView, SaveAsLauncher } from '@argus/shared';

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
  | 'menu:toggle-theme'
  | 'menu:open-diff'
  | 'menu:open-files'
  | 'menu:open-shell'
  | 'menu:terminal-search'
  | 'menu:clear-terminal'
  | 'menu:whats-new'
  | 'menu:review-launch';

export interface ElectronAppBridge {
  setBadge(count: number): void;
  onMenu(channel: MenuChannel, cb: () => void): () => void;
  /** Relaunch the app (quit + start fresh) — used to apply a startup-only setting. */
  relaunch(): void;
  /** Report whether a Monaco editor currently has focus, so main can disable the
   *  four menu accelerators that collide with Monaco's own default keybindings
   *  (Cmd+D/E/F/L) exactly while the keystroke needs to reach Monaco instead. */
  setEditorFocused(focused: boolean): void;
  /** Push the resolved keyboard bindings to main so the app-menu accelerators
   *  that mirror them follow a rebind. Those accelerators are the only route a
   *  shortcut has into a native terminal tile, whose child NSWindow takes key
   *  focus away from the renderer. Optional: an older preload simply never
   *  learns about a rebind, exactly as before this existed. */
  setMenuShortcuts?(shortcuts: Record<string, string>): void;
}

export interface ElectronNotificationsBridge {
  show(payload: { id: string; title: string; subtitle?: string; body: string; sound?: boolean; attributeToApp?: boolean }): void;
  close(id: string): void;
  onClick(cb: (id: string) => void): () => void;
}

export interface ElectronLaunchBridge {
  /** Deep-link scheme main registered: 'argus' packaged, 'argus-dev' in dev. */
  scheme?: string;
  list(): Promise<PendingLaunchView[]>;
  approve(id: string, saveAs?: SaveAsLauncher): Promise<LaunchActionResult>;
  discard(id: string): Promise<void>;
  onChanged(cb: () => void): () => void;
  onToast(cb: (t: { message: string; tone: 'ok' | 'warn' | 'danger' }) => void): () => void;
  launchers: {
    list(): Promise<Launcher[]>;
    rename(id: string, label: string): Promise<LaunchActionResult>;
    remove(id: string): Promise<LaunchActionResult>;
  };
}

declare global {
  interface Window {
    electronApp?: ElectronAppBridge;
    electronNotifications?: ElectronNotificationsBridge;
    electronLaunch?: ElectronLaunchBridge;
  }
}
