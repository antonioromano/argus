import { BrowserWindow, app, shell } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let win: BrowserWindow | null = null;
let appIsQuitting = false;
let stopAllOnQuit = false;

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
  win = new BrowserWindow({
    width: 1400,
    height: 900,
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
