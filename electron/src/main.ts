import { app, dialog } from 'electron';
import { createWindow, setAppQuitting } from './window.js';
import { createTray } from './tray.js';

let shutdownServer: (() => Promise<void>) | null = null;

async function main() {
  // fix-path: restore login-shell PATH so PtyManager can find 'claude' and other tools.
  // Must run before importing the server (server reads env at module evaluation time).
  try {
    const { default: fixPath } = await import('fix-path');
    fixPath();
  } catch {
    // fix-path not installed yet (dev environment) — continue without it
  }

  // Set environment variables before the dynamic server import because the
  // server reads process.env at module evaluation time.
  process.env.NODE_ENV = 'production';
  process.env.ARGUS_DATA_DIR = app.getPath('userData');
  // Use ARGUS_PORT if set (e.g. electron:dev sets 5403 to avoid conflicts), else 5400.
  if (!process.env.ARGUS_PORT) process.env.ARGUS_PORT = '5400';

  // Dynamic import after env vars are set so the server picks them up correctly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = await import('../../server/dist/index.js') as any;

  // Inject native folder-picker dialog so the server can open macOS directory sheets.
  server.setPickFolderFn(async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select project folder',
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  await server.startServer();
  shutdownServer = server.shutdownServer as () => Promise<void>;

  createWindow();
  createTray();
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[electron] startup error:', err);
    app.quit();
  });
});

// Prevent Electron from quitting when the last window is closed.
// The tray keeps the app alive; quitting is only via the tray menu or before-quit.
// window-all-closed: prevent default quit — tray keeps app alive
app.on('window-all-closed', () => {
  // Do nothing — let the tray keep the app alive
});

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;

  // Signal the window close-handler that this is a real quit, not a hide-to-tray.
  setAppQuitting(true);

  const doShutdown = shutdownServer ?? (() => Promise.resolve());
  doShutdown()
    .catch(console.error)
    .finally(() => app.quit());
});
