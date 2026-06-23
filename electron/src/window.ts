import { BrowserWindow, app, shell, screen } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

let win: BrowserWindow | null = null;
let appIsQuitting = false;
let stopAllOnQuit = false;

interface WindowState {
  fullscreen: boolean;
  displayId: number;
  bounds: { x: number; y: number; width: number; height: number };
  zoomLevel?: number; // whole-app zoom (Cmd +/-/0); persists across relaunch
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState | null {
  try {
    return JSON.parse(readFileSync(windowStatePath(), 'utf8')) as WindowState;
  } catch {
    return null;
  }
}

export function saveWindowState(): void {
  if (!win || win.isDestroyed()) return;
  try {
    const state: WindowState = {
      fullscreen: win.isFullScreen(),
      displayId: screen.getDisplayMatching(win.getBounds()).id,
      bounds: win.getNormalBounds(),
      zoomLevel: win.webContents.getZoomLevel(),
    };
    writeFileSync(windowStatePath(), JSON.stringify(state));
  } catch {
    // non-critical
  }
}

export function setAppQuitting(v: boolean): void {
  appIsQuitting = v;
}

// Whether the pending quit should also STOP all agent sessions (vs. the default
// keep-alive quit that detaches and leaves them running in tmux). Set by the
// "Quit & Stop All Sessions" menu item / tray entry; read in before-quit.
export function setStopAllOnQuit(v: boolean): void {
  stopAllOnQuit = v;
}

export function getStopAllOnQuit(): boolean {
  return stopAllOnQuit;
}

export function createWindow(): BrowserWindow {
  const saved = loadWindowState();

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

  win = new BrowserWindow({
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
      preload: join(__dirname, 'preload.js'),
      // Keep the renderer painting while hidden in the tray — reduces how often
      // the WebGL terminal surface loses its GPU context on hide/show.
      backgroundThrottling: false,
    },
  });

  // 127.0.0.1 (not "localhost"): the server binds IPv4 loopback, but macOS
  // resolves "localhost" to ::1 (IPv6) first — which can land on a *different*
  // server (e.g. a sibling Argus fork) that happens to hold the same port on
  // IPv6. Pinning 127.0.0.1 guarantees we reach our own server.
  const port = process.env.ARGUS_PORT || '5757';
  win.loadURL(`http://127.0.0.1:${port}`);

  // Restore persisted whole-app zoom once the page is ready. Re-applied on every
  // load (reload/route change reset zoom to 0 otherwise).
  if (saved?.zoomLevel) {
    win.webContents.on('did-finish-load', () => {
      win?.webContents.setZoomLevel(saved.zoomLevel ?? 0);
    });
  }

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
    win?.show();
    if (saved?.fullscreen) win?.setFullScreen(true);
    app.dock?.show();
  });

  win.on('close', (e) => {
    // If the app is quitting, allow the close. Otherwise hide to tray.
    if (!appIsQuitting) {
      e.preventDefault();
      win?.hide();
      app.dock?.hide();
    }
  });

  win.on('closed', () => {
    win = null;
  });

  return win;
}

export function showWindow(): void {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  app.dock?.show();
  win.show();
  win.focus();
}

export function getWindow(): BrowserWindow | null {
  return win;
}
