import { app, dialog, ipcMain, BrowserWindow, Menu, shell, nativeImage, Notification } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { execFile, spawn } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createWindow, setAppQuitting, getWindow, showWindow } from './window.js';
import { createTray } from './tray.js';

interface ApplyUpdateResult {
  success: boolean;
  error?: string;
}

/**
 * Self-update via Homebrew. Pre-checks brew presence (returns an error the modal
 * can show without quitting), then spawns a detached helper that waits for this
 * process to exit, runs `brew upgrade --cask argus`, and relaunches Argus.
 */
function applyBrewUpdate(): Promise<ApplyUpdateResult> {
  const loginShell = process.env.SHELL || '/bin/zsh';
  return new Promise((resolve) => {
    // Pre-check: is brew on PATH? Login shell so we get the user's full PATH.
    execFile(loginShell, ['-l', '-c', 'command -v brew'], (err, stdout) => {
      const brewPath = (stdout || '').trim();
      if (err || !brewPath) {
        resolve({
          success: false,
          error: 'Homebrew not found. Update via the GitHub release link below.',
        });
        return;
      }

      const logFile = join(app.getPath('userData'), 'update.log');
      // Helper runs after we exit: poll our PID until gone, upgrade, relaunch.
      const script = [
        `echo "[argus-update] $(date) starting" >> "${logFile}"`,
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
        `brew update >> "${logFile}" 2>&1`,
        `brew upgrade --cask argus >> "${logFile}" 2>&1`,
        `echo "[argus-update] $(date) relaunching" >> "${logFile}"`,
        `open -a Argus`,
      ].join('\n');

      const child = spawn(loginShell, ['-l', '-c', script], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      // Quit after the HTTP response flushes. Real quit path (not hide-to-tray).
      setTimeout(() => {
        setAppQuitting(true);
        app.quit();
      }, 500);

      resolve({ success: true });
    });
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

let shutdownServer: (() => Promise<void>) | null = null;

function readAppVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? app.getVersion();
  } catch {
    return app.getVersion();
  }
}

function sendMenuEvent(channel: string): void {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel);
  }
}

function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin';

  const appMenu: MenuItemConstructorOptions = {
    label: 'Argus',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      {
        label: 'Settings…',
        accelerator: 'CmdOrCtrl+,',
        click: () => sendMenuEvent('menu:open-settings'),
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New Session',
        accelerator: 'CmdOrCtrl+N',
        click: () => sendMenuEvent('menu:new-session'),
      },
      {
        label: 'Close Session',
        accelerator: 'CmdOrCtrl+W',
        click: () => sendMenuEvent('menu:close-session'),
      },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        label: 'Toggle Command Palette',
        accelerator: 'CmdOrCtrl+K',
        click: () => sendMenuEvent('menu:toggle-palette'),
      },
      { type: 'separator' },
      {
        label: 'Toggle Theme',
        accelerator: 'CmdOrCtrl+Shift+L',
        click: () => sendMenuEvent('menu:toggle-theme'),
      },
      { role: 'reload' },
      { role: 'forceReload' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' },
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      {
        label: 'Argus on GitHub',
        click: () => shell.openExternal('https://github.com/antonio/argus'),
      },
    ],
  };

  const template: MenuItemConstructorOptions[] = isMac
    ? [appMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu]
    : [fileMenu, editMenu, viewMenu, windowMenu, helpMenu];

  return Menu.buildFromTemplate(template);
}

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

  // Native message box — used by the renderer for confirmations (delete, close session, etc.)
  ipcMain.handle('dialog:showMessageBox', async (event, opts: Electron.MessageBoxOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return dialog.showMessageBox(win!, opts);
  });

  // Dock badge sync — renderer mirrors waiting-session count
  ipcMain.on('dock:setBadge', (_event, count: number) => {
    if (process.platform !== 'darwin') return;
    app.dock?.setBadge(count > 0 ? String(count) : '');
  });

  // Native notifications. Renderer can't set an icon via the Web Notification
  // API on macOS (Chromium ignores it and falls back to the bundle icon, which
  // is the Electron atom in dev). Routing through main lets us pass an explicit
  // nativeImage so the spartan icon always shows.
  const notifIcon = nativeImage.createFromPath(
    join(__dirname, '..', 'assets', 'icon_spartan_amber_v2_128.png'),
  );
  const activeNotifs = new Map<string, Notification>();

  ipcMain.on('notif:show', (_event, payload: { id: string; title: string; body: string }) => {
    const existing = activeNotifs.get(payload.id);
    if (existing) existing.close();

    const notif = new Notification({
      title: payload.title,
      body: payload.body,
      icon: notifIcon,
      silent: false,
    });
    notif.on('click', () => {
      showWindow();
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('notif:click', payload.id);
      activeNotifs.delete(payload.id);
    });
    notif.on('close', () => {
      if (activeNotifs.get(payload.id) === notif) activeNotifs.delete(payload.id);
    });
    notif.show();
    activeNotifs.set(payload.id, notif);
  });

  ipcMain.on('notif:close', (_event, id: string) => {
    const notif = activeNotifs.get(id);
    if (notif) {
      notif.close();
      activeNotifs.delete(id);
    }
  });

  // Native About panel
  const version = readAppVersion();
  app.setAboutPanelOptions({
    applicationName: 'Argus',
    applicationVersion: version,
    version,
    copyright: `© ${new Date().getFullYear()} Antonio Romano`,
    credits: 'Multi-session dashboard for Claude Code',
  });

  // Application menu — gives Cmd+N/W/,/K/Shift+L the native menu-bar treatment.
  Menu.setApplicationMenu(buildAppMenu());

  // Inject native folder-picker dialog so the server can open macOS directory sheets.
  server.setPickFolderFn(async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select project folder',
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // Inject brew-based self-update so the in-app "Update now" button works in the desktop app.
  server.setApplyUpdateFn(applyBrewUpdate);

  await server.startServer();
  shutdownServer = server.shutdownServer as () => Promise<void>;

  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(join(__dirname, '..', 'assets', 'icon.png'));
    app.dock?.setIcon(dockIcon);
  }

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
  const timeout = new Promise<void>((resolve) => setTimeout(() => {
    console.warn('[electron] shutdown timed out after 10s — forcing quit');
    resolve();
  }, 10_000));
  Promise.race([doShutdown(), timeout])
    .catch(console.error)
    .finally(() => app.quit());
});
