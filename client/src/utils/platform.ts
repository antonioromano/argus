import type { AppInfo, HelpActionResult, Launcher, LaunchActionResult, MenuCommandWire, PendingLaunchView, SaveAsLauncher } from '@argus/shared';
import type { LauncherImportItem, LauncherImportResult } from '../settings-backup/applyImport.js';

/** True when the renderer is running on macOS (Electron always is, but kept explicit). */
export const isMac =
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

/** Shortcut helper — Cmd on macOS, Ctrl elsewhere (mobile companion in a Linux/Windows browser). */
export function isPrimaryModifier(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

export interface ElectronAppBridge {
  setBadge(count: number): void;
  /** Renderer-run app-menu commands, one id per click (see client/src/commands/menuBridge.ts).
   *  The ids are declared in electron/src/menuModel.ts. */
  onMenuCommand(cb: (id: string) => void): () => void;
  /** Every app-menu command with its live accelerator. */
  describeMenu(): Promise<MenuCommandWire[]>;
  /** Run a main-owned app-menu command (New Window, Reload, Zoom…); main ignores any other id. */
  invokeMenu(id: string): void;
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
  /** Open a macOS System Settings pane (fixed URL in main). Absent on older preloads. */
  openSystemSettings?(pane: 'notifications'): void;
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
    /** Settings import: each request is re-validated on this Mac before it is saved. */
    import?(items: LauncherImportItem[]): Promise<{ ok: true; results: LauncherImportResult[] } | { ok: false; error: string }>;
  };
}

/** A dialog-backed file write or read. `canceled` when the user dismissed the dialog. */
export type SettingsFileResult =
  | { ok: true; path?: string; text?: string }
  | { ok: false; canceled?: true; error?: string };

/** Settings export / import (plan 007). Main owns every path; only text crosses. */
export interface ElectronSettingsBridge {
  /** Save dialog (default `argus-settings-YYYY-MM-DD.json`), then write `text`. */
  saveFile(text: string): Promise<SettingsFileResult>;
  /** Open dialog for a .json of at most 1 MB; resolves with its text. */
  openFile(): Promise<SettingsFileResult>;
  /** Writes `text` to userData/settings-backups (newest 10 kept). */
  backup(text: string): Promise<SettingsFileResult>;
  /** Shows the last exported file or backup in Finder. */
  reveal(which: 'export' | 'backup'): Promise<boolean>;
}

/** Help surfaces (plan 002). Main writes the diagnostics to the clipboard;
 *  only the outcome comes back. */
export interface ElectronHelpBridge {
  appInfo(): Promise<AppInfo | null>;
  copyDiagnostics(): Promise<HelpActionResult>;
  /** Copies the diagnostics, then opens a prefilled GitHub issue. */
  reportIssue(): Promise<HelpActionResult>;
}

declare global {
  interface Window {
    electronApp?: ElectronAppBridge;
    electronHelp?: ElectronHelpBridge;
    electronNotifications?: ElectronNotificationsBridge;
    electronLaunch?: ElectronLaunchBridge;
    electronSettings?: ElectronSettingsBridge;
  }
}
