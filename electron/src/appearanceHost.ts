/**
 * Electron side of the appearance bridge (plan 008): reads the macOS signals
 * (accent colour, Reduce Transparency, Increase Contrast, app/window activity,
 * fullscreen), composes one AppearanceSnapshot per window with the pure
 * functions in systemAppearance.ts, and pushes it as `appearance:changed`
 * whenever it changes. The renderer pulls the first one synchronously
 * (`appearance:snapshot`) so its first paint already has the right material.
 *
 * It also takes the renderer's theme choice (`appearance:set-theme`) and sets
 * nativeTheme.themeSource, so the window's vibrancy material is dark under a
 * dark Argus even on a light-mode Mac.
 */
import { app, ipcMain, nativeTheme, systemPreferences, BrowserWindow } from 'electron';
import type { AppearanceSnapshot } from '@argus/shared';
import { composeAppearance, isWindowActive, normalizeAccent } from './systemAppearance.js';
import { clampTitlebarHeight, trafficLights, DEFAULT_TITLEBAR_H } from './titlebarMetrics.js';
import type { IpcSenderLike } from './ipcGuards.js';

export type ThemeSourceMode = 'dark' | 'light' | 'system';

export interface AppearanceHostDeps {
  trusted: (e: IpcSenderLike) => boolean;
  windows: () => Iterable<BrowserWindow>;
  keyOverlayOwners: () => Iterable<BrowserWindow | null | undefined>;
  /** Called after the renderer sets the theme, with the resolved appearance. */
  onThemeChanged?: (dark: boolean) => void;
}

export interface AppearanceHost {
  /** Re-derive every window's snapshot soon (coalesced) and push the changed ones. */
  refresh(): void;
}

// Focus moves in two steps when a native tile takes key (the BrowserWindow
// blurs, then the overlay reports focus). Coalescing the recompute keeps the
// UI from flashing its inactive look between the two.
const COALESCE_MS = 40;

function readAccent(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    return normalizeAccent(systemPreferences.getAccentColor());
  } catch {
    return null;
  }
}

export function initAppearanceHost(deps: AppearanceHostDeps): AppearanceHost {
  let appActive = true;
  const lastSent = new WeakMap<BrowserWindow, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const snapshotFor = (win: BrowserWindow): AppearanceSnapshot =>
    composeAppearance({
      accent: readAccent(),
      reduceTransparency: nativeTheme.prefersReducedTransparency,
      highContrast: nativeTheme.shouldUseHighContrastColors,
      fullscreen: win.isFullScreen(),
      windowActive: isWindowActive(appActive, BrowserWindow.getFocusedWindow(), win, deps.keyOverlayOwners()),
      // Always solid: hardware acceleration is off (main.ts), and without GPU
      // compositing the window can't show the vibrancy behind it.
      materialSetting: 'solid',
      titlebarInset: trafficLights(DEFAULT_TITLEBAR_H).inset,
    });

  const pushAll = (): void => {
    timer = null;
    for (const win of deps.windows()) {
      if (win.isDestroyed()) continue;
      const snap = snapshotFor(win);
      const key = JSON.stringify(snap);
      if (lastSent.get(win) === key) continue;
      lastSent.set(win, key);
      win.webContents.send('appearance:changed', snap);
    }
  };

  const refresh = (): void => {
    if (timer) return;
    timer = setTimeout(pushAll, COALESCE_MS);
  };

  ipcMain.on('appearance:snapshot', (e) => {
    const win = deps.trusted(e) ? BrowserWindow.fromWebContents(e.sender) : null;
    if (!win) { e.returnValue = null; return; }
    const snap = snapshotFor(win);
    lastSent.set(win, JSON.stringify(snap));
    e.returnValue = snap;
  });

  ipcMain.on('appearance:set-theme', (e, mode: unknown) => {
    if (!deps.trusted(e) || (mode !== 'dark' && mode !== 'light' && mode !== 'system')) return;
    if (nativeTheme.themeSource !== mode) nativeTheme.themeSource = mode;
    deps.onThemeChanged?.(nativeTheme.shouldUseDarkColors);
  });

  // Density changes the toolbar height; the traffic lights follow it so they
  // stay centred on the row.
  ipcMain.on('appearance:titlebar-height', (e, raw: unknown) => {
    const h = clampTitlebarHeight(raw);
    const win = deps.trusted(e) && h !== null ? BrowserWindow.fromWebContents(e.sender) : null;
    if (!win || process.platform !== 'darwin') return;
    const { x, y } = trafficLights(h!);
    win.setWindowButtonPosition({ x, y });
  });

  nativeTheme.on('updated', () => {
    refresh();
    deps.onThemeChanged?.(nativeTheme.shouldUseDarkColors);
  });
  app.on('did-become-active', () => { appActive = true; refresh(); });
  app.on('did-resign-active', () => { appActive = false; refresh(); });
  app.on('browser-window-focus', refresh);
  app.on('browser-window-blur', refresh);
  app.on('browser-window-created', (_e, win) => {
    win.on('enter-full-screen', refresh);
    win.on('leave-full-screen', refresh);
  });
  if (process.platform === 'darwin') {
    systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', refresh);
    // Reduce Transparency / Increase Contrast toggles; nativeTheme 'updated'
    // is only documented for dark mode and high contrast.
    systemPreferences.subscribeWorkspaceNotification('NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification', refresh);
  }

  return { refresh };
}
