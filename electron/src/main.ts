import { app, dialog, ipcMain, BrowserWindow, Menu, shell, nativeImage, Notification } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { execFile, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createWindow, setAppQuitting, getWindow, showWindow, setStopAllOnQuit, getStopAllOnQuit } from './window.js';
import { createTray } from './tray.js';

// Render terminals on the CPU, not the GPU. On a cold GPU (first open of a
// session, or after the shader cache is evicted) Chromium's GPU glyph
// rasterization intermittently fails for special glyphs — box-drawing renders
// as "__" and the Claude icon as a black block — and only a reload clears it.
// This is renderer-agnostic (hit DOM/Canvas/WebGL alike) and reproduces only in
// the packaged app's cold-GPU state (never in the warm `npm run dev` session).
// Disabling hardware acceleration removes the GPU raster path entirely, so the
// failure mode can't occur. Must be called before app 'ready'.
app.disableHardwareAcceleration();

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
      const lockFile = join(app.getPath('userData'), 'update.lock');
      // Helper runs after we exit: poll our PID until gone, upgrade, relaunch.
      // Lock file prevents the relaunched app from re-triggering the update loop.
      const script = [
        `echo "[argus-update] $(date) starting" >> "${logFile}"`,
        // Bail immediately if another upgrade helper is already running.
        `if [ -f "${lockFile}" ]; then echo "[argus-update] already running, exiting" >> "${logFile}"; exit 0; fi`,
        `echo $$ > "${lockFile}"`,
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
        `brew update >> "${logFile}" 2>&1`,
        `brew upgrade --cask argus >> "${logFile}" 2>&1`,
        `BREW_EXIT=$?`,
        // Only relaunch if brew actually changed the installed version.
        `INSTALLED=$(brew info --cask argus 2>/dev/null | grep -oE '/opt/homebrew/Caskroom/argus/[^ ]+' | head -1 | xargs basename 2>/dev/null)`,
        `rm -f "${lockFile}"`,
        `if [ $BREW_EXIT -eq 0 ]; then`,
        `  echo "[argus-update] $(date) relaunching (installed: $INSTALLED)" >> "${logFile}"`,
        `  open -a Argus`,
        `else`,
        `  echo "[argus-update] $(date) upgrade failed (exit $BREW_EXIT), not relaunching" >> "${logFile}"`,
        `fi`,
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
let shutdownServerStoppingAll: (() => Promise<void>) | null = null;

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
      { role: 'quit' }, // keep-alive: detaches, sessions keep running in the background
      {
        label: 'Quit & Stop All Sessions',
        accelerator: 'CmdOrCtrl+Shift+Q',
        click: () => {
          setStopAllOnQuit(true);
          app.quit();
        },
      },
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
  // Use ARGUS_PORT if set (e.g. electron:dev sets 5403 to avoid conflicts), else 5757.
  // 5757 (not 5400) keeps the packaged app off the port a sibling fork like
  // remote-orchestrator may already hold.
  if (!process.env.ARGUS_PORT) process.env.ARGUS_PORT = '5757';
  // Namespace the tmux socket per app identity so sibling forks never share a
  // tmux server. app.getName() is 'Argus' for the packaged app, 'Electron' in
  // unpackaged dev — automatic isolation.
  if (!process.env.ARGUS_TMUX_SOCKET) process.env.ARGUS_TMUX_SOCKET = app.getName().toLowerCase();

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

  // Packaged delivery goes through the vendored terminal-notifier.app (see
  // electron/resources/terminal-notifier/README.md). Ad-hoc signed bundles are
  // untrusted, so usernoted silently drops both Electron's native Notification
  // posts AND `osascript display notification` (osascript is attributed to the
  // responsible process — Argus itself — not to a trusted system bundle, which
  // is why the 0.16.42 osascript route never delivered). terminal-notifier is
  // its own .app, so its posts are attributed to it; macOS prompts the user
  // once to allow "terminal-notifier" and then delivery works.
  const resolveTerminalNotifier = (): string | null => {
    const override = process.env.ARGUS_TERMINAL_NOTIFIER_PATH;
    if (override) return existsSync(override) ? override : null;
    if (!app.isPackaged) return null;
    const bundled = join(
      process.resourcesPath,
      'terminal-notifier',
      'terminal-notifier.app',
      'Contents',
      'MacOS',
      'terminal-notifier',
    );
    return existsSync(bundled) ? bundled : null;
  };
  const terminalNotifierPath = resolveTerminalNotifier();
  // Loose (non-asar) copy of the icon, shipped via extraResources, so the
  // external terminal-notifier process can read it for -contentImage.
  const notifContentImage = join(process.resourcesPath, 'notif-icon.png');

  ipcMain.on('notif:show', (_event, payload: { id: string; title: string; body: string }) => {
    console.log(`[notif] show requested id=${payload.id} title=${JSON.stringify(payload.title)}`);

    if (app.isPackaged) {
      if (terminalNotifierPath) {
        const args = [
          '-title', payload.title,
          '-message', payload.body,
          // Same-group notifications replace each other — mirrors the dev
          // path's existing.close() behavior for repeated session alerts.
          '-group', payload.id,
          // Click focuses Argus. (No per-session deep-link in packaged mode;
          // terminal-notifier can't round-trip the notif:click IPC.)
          '-activate', 'com.antonio.argus',
        ];
        if (existsSync(notifContentImage)) args.push('-contentImage', notifContentImage);
        execFile(terminalNotifierPath, args, (err) => {
          if (err) console.error(`[notif] terminal-notifier failed id=${payload.id}:`, err);
          else console.log(`[notif] terminal-notifier delivered id=${payload.id}`);
        });
        return;
      }
      // Fallback when the bundled notifier is missing. Known to be dropped by
      // usernoted for ad-hoc builds (attributed to Argus), but harmless — keeps
      // the code path alive for a future Developer-ID-signed build.
      execFile(
        'osascript',
        [
          '-e', 'on run argv',
          '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
          '-e', 'end run',
          '--', payload.body, payload.title,
        ],
        (err) => {
          if (err) console.error(`[notif] osascript failed id=${payload.id}:`, err);
          else console.log(`[notif] osascript exited 0 id=${payload.id} (delivery not guaranteed)`);
        },
      );
      return;
    }

    // Dev (native) path. isSupported() is meaningful here since the host bundle
    // is Apple-signed.
    if (!Notification.isSupported()) {
      console.warn('[notif] Notification.isSupported() === false — OS will not deliver');
      return;
    }

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
    notif.on('failed', (_e, error) => {
      console.error(`[notif] delivery failed id=${payload.id}: ${error}`);
    });
    try {
      notif.show();
      console.log(`[notif] show() called id=${payload.id}`);
    } catch (err) {
      console.error(`[notif] show() threw id=${payload.id}:`, err);
    }
    activeNotifs.set(payload.id, notif);
  });

  ipcMain.on('notif:close', (_event, id: string) => {
    if (app.isPackaged && terminalNotifierPath) {
      execFile(terminalNotifierPath, ['-remove', id], (err) => {
        if (err) console.error(`[notif] terminal-notifier -remove failed id=${id}:`, err);
      });
      return;
    }
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
  // Serialize concurrent calls: a double-click/held-shortcut in the renderer must not
  // stack two native dialogs — reuse the in-flight promise instead.
  let pickInFlight: Promise<string | null> | null = null;
  server.setPickFolderFn(async (): Promise<string | null> => {
    if (pickInFlight) return pickInFlight;
    pickInFlight = dialog
      .showOpenDialog({ properties: ['openDirectory'], title: 'Select project folder' })
      .then((result) => (result.canceled ? null : (result.filePaths[0] ?? null)))
      .finally(() => { pickInFlight = null; });
    return pickInFlight;
  });

  // Inject brew-based self-update so the in-app "Update now" button works in the desktop app.
  server.setApplyUpdateFn(applyBrewUpdate);

  await server.startServer();
  shutdownServer = server.shutdownServer as () => Promise<void>;
  shutdownServerStoppingAll = server.shutdownServerStoppingAll as () => Promise<void>;

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

  // Default quit detaches (keep-alive); "Quit & Stop All" terminates every agent.
  const chosen = getStopAllOnQuit() ? shutdownServerStoppingAll : shutdownServer;
  const doShutdown = chosen ?? (() => Promise.resolve());
  const timeout = new Promise<void>((resolve) => setTimeout(() => {
    console.warn('[electron] shutdown timed out after 10s — forcing quit');
    resolve();
  }, 10_000));
  Promise.race([doShutdown(), timeout])
    .catch(console.error)
    .finally(() => app.quit());
});
