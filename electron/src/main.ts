import { app, dialog, ipcMain, BrowserWindow, Menu, shell, nativeImage, Notification } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { execFile, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createWindow, setAppQuitting, getWindow, showWindow, setStopAllOnQuit, getStopAllOnQuit, saveWindowState } from './window.js';
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

// Keep Chromium's OSCrypt off the OS credential store. OSCrypt otherwise creates an
// "Argus Safe Storage" keychain item to encrypt the on-disk cookie/local-state store,
// and macOS re-prompts for the keychain password on every update because ad-hoc
// signing gives each build a new code-signing identity (the keychain ACL is bound to
// that identity). Argus keeps no sensitive data in cookies (state lives in
// localStorage, app loads 127.0.0.1), so the keychain dependency is pure friction.
// - macOS: --password-store is a Linux-only switch and a no-op here; --use-mock-keychain
//   is what actually keeps OSCrypt off the real Keychain (mock in-memory key). This is
//   the switch that stops the prompt.
// - Linux: --password-store=basic selects the plaintext backend.
// Both must be set before app 'ready'.
app.commandLine.appendSwitch('use-mock-keychain');
app.commandLine.appendSwitch('password-store', 'basic');

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
        `brew trust antonioromano/argus >> "${logFile}" 2>&1 || true`,
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
        `  echo "[argus-update] $(date) upgrade failed (exit $BREW_EXIT), relaunching previous version" >> "${logFile}"`,
        `  open -a Argus`,
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
        label: 'Toggle Find & Jump',
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
  // Dev (`electron .`) and the packaged app share the SAME identity: the root
  // package.json name is 'argus', so app.getName() === 'argus' in BOTH — not
  // 'Electron' as Electron's default would suggest. Without isolation they share
  // one ARGUS_DATA_DIR (sessions.json) and one '-L argus' tmux server: dueling
  // tmux clients trigger resize storms (garbled, dot-filled terminals), and the
  // dev instance's "Quit & Stop All" runs kill-server on the shared socket,
  // killing the INSTALLED app's agents. Gate isolation on app.isPackaged so dev
  // always gets its own socket + data dir.
  const devIsolation = !app.isPackaged;
  process.env.ARGUS_DATA_DIR = devIsolation
    ? join(app.getPath('userData'), '..', 'argus-dev')
    : app.getPath('userData');
  // Use ARGUS_PORT if set (e.g. electron:dev sets 5403 to avoid conflicts), else 5757.
  // 5757 (not 5400) keeps the packaged app off the port a sibling fork like
  // remote-orchestrator may already hold.
  if (!process.env.ARGUS_PORT) process.env.ARGUS_PORT = '5757';
  // Namespace the tmux socket so dev and the packaged app never share a tmux
  // server. 'argus-dev' for unpackaged dev, 'argus' (app name) for the packaged app.
  if (!process.env.ARGUS_TMUX_SOCKET) {
    process.env.ARGUS_TMUX_SOCKET = devIsolation ? 'argus-dev' : app.getName().toLowerCase();
  }

  // Dynamic import after env vars are set so the server picks them up correctly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = await import('../../server/dist/index.js') as any;

  // Native message box — used by the renderer for confirmations (delete, close session, etc.)
  ipcMain.handle('dialog:showMessageBox', async (event, opts: Electron.MessageBoxOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    return dialog.showMessageBox(win!, opts);
  });

  // Open URLs in the system default browser (called from WebLinksAddon click handler).
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    if (/^(https?:|mailto:)/.test(url)) shell.openExternal(url);
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
    const bin = join('terminal-notifier', 'terminal-notifier.app', 'Contents', 'MacOS', 'terminal-notifier');
    if (app.isPackaged) {
      const bundled = join(process.resourcesPath, bin);
      return existsSync(bundled) ? bundled : null;
    }
    // Dev: compiled main.js is in electron/dist/ — resources are one level up
    const devPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', bin);
    return existsSync(devPath) ? devPath : null;
  };
  const terminalNotifierPath = resolveTerminalNotifier();

  ipcMain.on('notif:show', (_event, payload: { id: string; title: string; subtitle?: string; body: string; sound?: boolean }) => {
    console.log(`[notif] show requested id=${payload.id} title=${JSON.stringify(payload.title)}`);

    // Use terminal-notifier when available — works in dev and packaged alike
    // because it spawns as its own .app bundle and gets its own usernoted attribution
    // (unlike Electron native Notification or osascript, which are attributed to Argus
    // itself and silently dropped for ad-hoc builds).
    // NOTE: terminal-notifier 2.0.0 silently drops -message bodies that start with '['.
    // Always pass session name via -subtitle so the body is bracket-free.
    if (terminalNotifierPath) {
      const args = [
        '-title', payload.title,
        ...(payload.subtitle ? ['-subtitle', payload.subtitle] : []),
        '-message', payload.body,
        // Same-group notifications replace each other.
        '-group', payload.id,
        // Click focuses Argus. (No per-session deep-link; terminal-notifier
        // can't round-trip the notif:click IPC.)
        '-activate', 'com.antonio.argus',
      ];
      if (payload.sound) args.push('-sound', 'default');
      execFile(terminalNotifierPath, args, (err) => {
        if (err) console.error(`[notif] terminal-notifier failed id=${payload.id}:`, err);
        else console.log(`[notif] terminal-notifier delivered id=${payload.id}`);
      });
      return;
    }

    if (app.isPackaged) {
      // Packaged build but bundled notifier missing — osascript fallback.
      // Known to be dropped by usernoted for ad-hoc builds, but harmless;
      // keeps the path alive for a future Developer-ID-signed build.
      execFile(
        'osascript',
        [
          '-e', 'on run argv',
          '-e', payload.sound
            ? 'display notification (item 1 of argv) with title (item 2 of argv) sound name "Ping"'
            : 'display notification (item 1 of argv) with title (item 2 of argv)',
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

    // Dev without terminal-notifier — native Electron Notification.
    // May not deliver for ad-hoc builds (usernoted attribution). Kept as
    // last-resort fallback if the source notifier binary is absent.
    if (!Notification.isSupported()) {
      console.warn('[notif] Notification.isSupported() === false — OS will not deliver');
      return;
    }

    const existing = activeNotifs.get(payload.id);
    if (existing) existing.close();

    const notif = new Notification({
      title: payload.title,
      subtitle: payload.subtitle,
      body: payload.body,
      icon: notifIcon,
      silent: !payload.sound,
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

  await server.startServer().catch(async (err: Error) => {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Argus — Port conflict',
      message: `Could not start server: ${err.message}\n\nAnother process may already be using port ${process.env.ARGUS_PORT || '5757'}. Close it and try again.`,
      buttons: ['Quit'],
    });
    setAppQuitting(true);
    app.quit();
    throw err;
  });
  shutdownServer = server.shutdownServer as () => Promise<void>;
  shutdownServerStoppingAll = server.shutdownServerStoppingAll as () => Promise<void>;

  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(join(__dirname, '..', 'assets', 'icon.png'));
    app.dock?.setIcon(dockIcon);
  }

  createWindow();
  createTray();
}

// Single-instance lock: second launch focuses the existing window and quits.
if (!app.requestSingleInstanceLock()) {
  // The lock is keyed by the userData dir, which is appData/<app.getName()> —
  // and app.getName() is 'argus' for BOTH the packaged app and unpackaged dev
  // (`electron .`). So a dev launch while the installed app is running (or vice
  // versa) fails the lock and exits here. This is by design (one window, no
  // contention), but logged so the "instant quit" isn't mistaken for a crash.
  console.log(
    '[electron] another Argus instance already holds the single-instance lock ' +
    `(userData "${app.getPath('userData')}", app "${app.getName()}"); quitting. ` +
    'Quit the other instance first to launch this one.',
  );
  app.quit();
} else {
  app.on('second-instance', () => { showWindow(); });

  app.whenReady().then(() => {
    main().catch((err) => {
      console.error('[electron] startup error:', err);
      app.quit();
    });
  });
}

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

  // Save window state before shutdown so position/fullscreen survives a restart.
  saveWindowState();

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
