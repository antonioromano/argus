import { BrowserWindow, app } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let win: BrowserWindow | null = null;
let appIsQuitting = false;

export function setAppQuitting(v: boolean): void {
  appIsQuitting = v;
}

export function createWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
  });

  const port = process.env.ARGUS_PORT || '5400';
  win.loadURL(`http://localhost:${port}`);

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
