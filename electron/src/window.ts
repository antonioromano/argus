import { BrowserWindow, app, shell, screen } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_WINDOW_ID = 'main'; // mirror of @argus/shared MAIN_WINDOW_ID (electron avoids the runtime dep)

const windows = new Map<string, BrowserWindow>();
const zoomLevels = new Map<string, number>();
// Windows being torn down programmatically (server-initiated) — their 'close'
// event must NOT re-trigger the delete round-trip.
const destroying = new Set<string>();
let appIsQuitting = false;
let stopAllOnQuit = false;
let onSecondaryClose: ((windowId: string) => void) | null = null;

interface PersistedWindowState {
  fullscreen: boolean;
  displayId: number;
  bounds: { x: number; y: number; width: number; height: number };
  zoomLevel?: number; // whole-app zoom (Cmd +/-/0); persists across relaunch
}
// windowId → state. Legacy (pre-multi-window) file was a single PersistedWindowState.
type WindowStateFile = Record<string, PersistedWindowState>;

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadWindowStates(): WindowStateFile {
  try {
    const parsed = JSON.parse(readFileSync(windowStatePath(), 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && 'bounds' in (parsed as object)) {
      // Legacy single-window shape → migrate as the main window's state.
      return { [MAIN_WINDOW_ID]: parsed as PersistedWindowState };
    }
    return (parsed as WindowStateFile) ?? {};
  } catch {
    return {};
  }
}

export function saveAllWindowStates(): void {
  const states = loadWindowStates(); // keep entries for windows not currently open
  for (const [id, win] of windows) {
    if (win.isDestroyed()) continue;
    states[id] = {
      fullscreen: win.isFullScreen(),
      displayId: screen.getDisplayMatching(win.getBounds()).id,
      bounds: win.getNormalBounds(),
      zoomLevel: zoomLevels.get(id) ?? 0,
    };
  }
  try {
    writeFileSync(windowStatePath(), JSON.stringify(states));
  } catch {
    // non-critical
  }
}

export function setSecondaryCloseHandler(fn: (windowId: string) => void): void {
  onSecondaryClose = fn;
}

export function setAppQuitting(v: boolean): void {
  appIsQuitting = v;
}

// Whether the pending quit should also STOP all agent sessions (vs. the default
// keep-alive quit that detaches and leaves them running in tmux). Set by the
// "Quit & Stop All Sessions" menu item; read in before-quit.
export function setStopAllOnQuit(v: boolean): void {
  stopAllOnQuit = v;
}

export function getStopAllOnQuit(): boolean {
  return stopAllOnQuit;
}

export function createAppWindow(windowId: string): BrowserWindow {
  const saved = loadWindowStates()[windowId];
  zoomLevels.set(windowId, saved?.zoomLevel ?? 0);

  // Resolve target display: use saved display if still connected, else primary.
  let displayBounds = screen.getPrimaryDisplay().workArea;
  if (saved) {
    const match = screen.getAllDisplays().find((d) => d.id === saved.displayId);
    if (match) displayBounds = match.workArea;
  }

  // Derive initial bounds: restore saved (clamped to display) or center on display.
  let initX: number | undefined;
  let initY: number | undefined;
  let initW = 1400;
  let initH = 900;
  if (saved) {
    initW = Math.max(800, Math.min(saved.bounds.width, displayBounds.width));
    initH = Math.max(600, Math.min(saved.bounds.height, displayBounds.height));
    // Only restore x/y if the window would land on the target display.
    const inBounds =
      saved.bounds.x >= displayBounds.x &&
      saved.bounds.x + saved.bounds.width <= displayBounds.x + displayBounds.width;
    if (inBounds) {
      initX = saved.bounds.x;
      initY = saved.bounds.y;
    }
  }

  const win = new BrowserWindow({
    width: initW,
    height: initH,
    ...(initX !== undefined ? { x: initX, y: initY } : {}),
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Sandbox the renderer. The preload only uses contextBridge/ipcRenderer/
      // webUtils — all available in sandboxed preloads — so the drop-path bridge
      // and IPC keep working while the renderer (which paints untrusted bytes:
      // filenames, diffs, terminal output) loses direct OS access.
      sandbox: true,
      preload: join(__dirname, 'preload.js'),
      // Keep the renderer painting while the window is hidden — reduces how often
      // the WebGL terminal surface loses its GPU context on hide/show.
      backgroundThrottling: false,
    },
  });

  // 127.0.0.1 (not "localhost"): the server binds IPv4 loopback, but macOS
  // resolves "localhost" to ::1 (IPv6) first — which can land on a *different*
  // server (e.g. a sibling Argus fork) that happens to hold the same port on
  // IPv6. Pinning 127.0.0.1 guarantees we reach our own server.
  const port = process.env.ARGUS_PORT || '5757';
  win.loadURL(`http://127.0.0.1:${port}/?windowId=${windowId}`);

  // Re-apply the tracked whole-app zoom on every load — webContents resets zoom
  // to 0 on reload/route change otherwise. Unconditional so a 0 (100%) level is
  // honoured too, and always the *current* tracked value, never a stale snapshot.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomLevel(zoomLevels.get(windowId) ?? 0);
  });

  // Route external links to the system default browser instead of opening an
  // in-app Electron frame. Covers target="_blank"/window.open and xterm.js
  // WebLinksAddon clicks (both go through setWindowOpenHandler), plus bare
  // <a href> navigations that would otherwise replace the app (will-navigate).
  // Scheme allowlist is deliberate — never hand file:/custom schemes to the OS.
  const appOrigin = `http://127.0.0.1:${port}`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(appOrigin)) return; // in-app nav (reload, routing) OK
    e.preventDefault();
    if (/^(https?:|mailto:)/.test(url)) shell.openExternal(url);
  });

  win.once('ready-to-show', () => {
    win.show();
    if (saved?.fullscreen) win.setFullScreen(true);
    app.dock?.show();
  });

  win.on('close', (e) => {
    if (appIsQuitting || destroying.has(windowId)) return; // allow real close
    if (windowId === MAIN_WINDOW_ID) {
      // Main: hide, keep app alive (existing behavior).
      e.preventDefault();
      win.hide();
      if (![...windows.values()].some((w) => !w.isDestroyed() && w.isVisible())) {
        app.dock?.hide();
      }
      return;
    }
    // Secondary: real close, but the server owns the decision — it deletes the
    // window record (merging sessions back to main) and calls destroyAppWindow
    // via the onClose host hook.
    e.preventDefault();
    onSecondaryClose?.(windowId);
  });
  win.on('closed', () => {
    windows.delete(windowId);
    zoomLevels.delete(windowId);
    destroying.delete(windowId);
  });
  windows.set(windowId, win);

  return win;
}

export function destroyAppWindow(windowId: string): void {
  const win = windows.get(windowId);
  if (!win || win.isDestroyed()) return;
  // Persist bounds before teardown so a re-created window with the same id
  // (unlikely but possible) lands where it was.
  saveAllWindowStates();
  destroying.add(windowId);
  win.destroy();
}

export function getAppWindow(windowId: string): BrowserWindow | null {
  const win = windows.get(windowId);
  return win && !win.isDestroyed() ? win : null;
}

export function getMainWindow(): BrowserWindow | null {
  return getAppWindow(MAIN_WINDOW_ID);
}

export function getFocusedWindowId(): string {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) {
    for (const [id, win] of windows) if (win === focused) return id;
  }
  return MAIN_WINDOW_ID;
}

export function focusAppWindow(windowId: string): void {
  const win = getAppWindow(windowId) ?? getMainWindow();
  if (!win) return;
  app.dock?.show();
  win.show();
  win.focus();
}

export function showWindow(): void {
  focusAppWindow(MAIN_WINDOW_ID);
}

export function setZoomLevelForFocused(level: number): void {
  const id = getFocusedWindowId();
  zoomLevels.set(id, level);
  getAppWindow(id)?.webContents.setZoomLevel(level);
}

export function getZoomLevelForFocused(): number {
  return zoomLevels.get(getFocusedWindowId()) ?? 0;
}
