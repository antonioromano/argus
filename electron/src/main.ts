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

// Give unpackaged dev (`electron .`) its OWN Electron profile so it can run
// alongside the installed app. The single-instance lock (below) keys off
// app.getPath('userData'), and app.getName() === 'argus' for BOTH dev and the
// packaged app — so without this they share one userData dir + one lock, and a
// dev launch dies instantly when the installed app holds the lock. Pointing dev
// at a sibling 'argus-dev' userData gives it a distinct lock key (and its own
// Chromium cache, window state, and Safe-Storage entry). Must run before
// requestSingleInstanceLock() and before app 'ready'.
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('userData'), '..', 'argus-dev'));
}

// Notification deep-link scheme. Dev uses 'argus-dev://' so a notification raised
// by the dev instance routes back to the dev window instead of the installed app
// (which owns 'argus://'). Drives setAsDefaultProtocolClient, the terminal-notifier
// -execute URL, and the open-url strip below.
const SCHEME = app.isPackaged ? 'argus' : 'argus-dev';

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
// Quit-time preference getters, injected from the in-process server module.
let getExitSessionsOnQuit: (() => boolean) | null = null;
let getConfirmExitOnQuit: (() => boolean) | null = null;
let setConfirmExitOnQuit: ((v: boolean) => Promise<void>) | null = null;
let getActiveSessionSummaries: (() => { name: string; status: string }[]) | null = null;

// Session ids are crypto.randomUUID() values. Validate any id that crosses the
// IPC/URL boundary before it reaches terminal-notifier — its `-execute` runs via
// /bin/sh, so an unvalidated id would be a shell-injection sink. UUID chars only.
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolved terminal-notifier binary path, set in main(). Module-level so the
// top-level `open-url` handler can clear a clicked notification from Notification
// Center after deep-linking it.
let terminalNotifierPath: string | null = null;

// Bring Argus forward and deliver a clicked notification's session id to the
// renderer, reusing the existing `notif:click` → highlightSession glow/focus
// chain. Called from `open-url` (packaged terminal-notifier deep-link) — the dev
// native-Notification path sends `notif:click` directly.
function deliverNotifClick(id: string): void {
  showWindow();
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    const send = () => win.webContents.send('notif:click', id);
    // Cold-start: the click may launch the app before the renderer mounts its
    // notif:click listener — defer until the page has loaded.
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
  }
  // The banner is consumed by the click, but an alert-style notification lingers
  // in Notification Center — remove it by its group id.
  if (terminalNotifierPath) {
    execFile(terminalNotifierPath, ['-remove', id], () => {});
  }
}

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
      // Whole-app browser zoom (scales terminals, Monaco, and UI uniformly).
      { role: 'resetZoom' },   // CmdOrCtrl+0
      { role: 'zoomIn' },      // CmdOrCtrl+Plus (also accepts Cmd+=)
      { role: 'zoomOut' },     // CmdOrCtrl+-
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
  // userData already carries the dev/packaged split (set at module load before the
  // single-instance lock): '…/argus-dev' for dev, '…/argus' for packaged. Co-locate
  // server data (sessions.json, order.json) with the Electron profile.
  process.env.ARGUS_DATA_DIR = app.getPath('userData');
  if (devIsolation) {
    // CRITICAL: dev is often launched from a terminal INSIDE a packaged Argus
    // session, which exports the installed app's ARGUS_PORT=5757 and
    // ARGUS_TMUX_SOCKET=argus into the child env. Inheriting those makes dev
    // collide with the installed app — shared port AND a shared '-L argus' tmux
    // server (the exact dueling-tmux / killed-agents failure noted above). So for
    // dev we FORCE isolated values, ignoring whatever was inherited. 5403 also
    // matches the electron:dev script override, so there's nothing to configure.
    process.env.ARGUS_PORT = '5403';
    process.env.ARGUS_TMUX_SOCKET = 'argus-dev';
  } else {
    // Packaged launches from Finder/Dock with a clean env; honor explicit overrides.
    // 5757 (not 5400) keeps the packaged app off the port a sibling fork like
    // remote-orchestrator may already hold.
    if (!process.env.ARGUS_PORT) process.env.ARGUS_PORT = '5757';
    if (!process.env.ARGUS_TMUX_SOCKET) process.env.ARGUS_TMUX_SOCKET = app.getName().toLowerCase();
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
  terminalNotifierPath = resolveTerminalNotifier();

  ipcMain.on('notif:show', (_event, payload: { id: string; title: string; subtitle?: string; body: string; sound?: boolean }) => {
    console.log(`[notif] show requested id=${payload.id} title=${JSON.stringify(payload.title)}`);

    // Reject any id that isn't a UUID: it's interpolated into terminal-notifier's
    // -execute shell command below (and used as -group/-remove key).
    if (!SESSION_ID_RE.test(payload.id)) {
      console.error(`[notif] rejected non-UUID id=${JSON.stringify(payload.id)}`);
      return;
    }

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
        // Click opens the SCHEME:// url, which activates this instance AND fires the
        // main-process open-url handler with the session id — the only way to
        // round-trip a per-session deep-link through terminal-notifier (it can't
        // reach the notif:click IPC). The id is a UUID, so it's shell-safe.
        '-execute', `open "${SCHEME}://notif/${payload.id}"`,
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
  getExitSessionsOnQuit = server.getExitSessionsOnQuit as () => boolean;
  getConfirmExitOnQuit = server.getConfirmExitOnQuit as () => boolean;
  setConfirmExitOnQuit = server.setConfirmExitOnQuit as (v: boolean) => Promise<void>;
  getActiveSessionSummaries = server.getActiveSessionSummaries as () => { name: string; status: string }[];

  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(join(__dirname, '..', 'assets', 'icon.png'));
    app.dock?.setIcon(dockIcon);
    // Mark the dev instance so it's distinguishable from the installed app when
    // both run at once.
    if (!app.isPackaged) app.dock?.setBadge('dev');
  }

  createWindow();
  createTray();
}

// Single-instance lock: a second launch of the SAME profile focuses the existing
// window and quits. The lock keys off the userData dir, which now differs by mode
// ('…/argus-dev' for dev, '…/argus' for packaged — see module-load setup), so dev
// and the installed app each hold their own lock and run side by side. This branch
// only fires for a second launch of the same mode; logged so the "instant quit"
// isn't mistaken for a crash.
if (!app.requestSingleInstanceLock()) {
  console.log(
    '[electron] another Argus instance already holds the single-instance lock ' +
    `(userData "${app.getPath('userData')}", app "${app.getName()}"); quitting. ` +
    'Focusing the existing window instead.',
  );
  app.quit();
} else {
  app.on('second-instance', () => { showWindow(); });

  // Custom URL scheme for notification-click deep-linking (packaged: Info.plist
  // CFBundleURLTypes via electron-builder `protocols` registers 'argus'; this call
  // covers dev, which uses 'argus-dev' so deep-links route to the dev instance).
  app.setAsDefaultProtocolClient(SCHEME);
  // macOS routes `open <SCHEME>://notif/<id>` here (the running instance, since we
  // hold the single-instance lock). Registered before whenReady so a launch-on-
  // click delivers once the renderer is ready.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const id = url.replace(new RegExp(`^${SCHEME}://notif/`), '').replace(/\/$/, '');
    if (SESSION_ID_RE.test(id)) deliverNotifClick(id);
  });

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

  // "Quit & Stop All" (explicit menu item) sets the flag; the General setting
  // makes plain Cmd+Q terminate everything too. Either one means stop-all.
  const explicitStopAll = getStopAllOnQuit();
  const settingStopAll = getExitSessionsOnQuit?.() ?? false;
  const wantStopAll = explicitStopAll || settingStopAll;

  // Runs the actual shutdown + quit once any confirmation has cleared.
  const proceed = () => {
    quitting = true;
    // Save window state before shutdown so position/fullscreen survives a restart.
    saveWindowState();
    // Signal the window close-handler that this is a real quit, not a hide-to-tray.
    setAppQuitting(true);

    // Default quit detaches (keep-alive); stop-all terminates every agent.
    const chosen = wantStopAll ? shutdownServerStoppingAll : shutdownServer;
    const doShutdown = chosen ?? (() => Promise.resolve());
    const timeout = new Promise<void>((resolve) => setTimeout(() => {
      console.warn('[electron] shutdown timed out after 10s — forcing quit');
      resolve();
    }, 10_000));
    Promise.race([doShutdown(), timeout])
      .catch(console.error)
      .finally(() => app.quit());
  };

  // Confirm only when the destructive quit was triggered by the setting (not the
  // explicit menu item, which is already a deliberate choice) and isn't suppressed.
  const needsConfirm = settingStopAll && !explicitStopAll && (getConfirmExitOnQuit?.() ?? true);
  if (needsConfirm) {
    const sessions = getActiveSessionSummaries?.() ?? [];
    if (sessions.length === 0) { proceed(); return; }

    const names = sessions.slice(0, 10).map((s) => `• ${s.name}`).join('\n');
    const extra = sessions.length > 10 ? `\n…and ${sessions.length - 10} more` : '';
    const opts = {
      type: 'warning' as const,
      title: 'Exit all sessions?',
      message: `Quitting will stop ${sessions.length} Claude session${sessions.length === 1 ? '' : 's'}.`,
      detail: `These sessions will be terminated and cannot be resumed:\n\n${names}${extra}`,
      buttons: ['Cancel', 'Exit all sessions'],
      defaultId: 1,
      cancelId: 0,
      checkboxLabel: "Don't ask again",
      checkboxChecked: false,
    };
    const win = getWindow();
    const dlg = win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
    dlg
      .then((r) => {
        if (r.response === 0) return; // Cancel — stay open, sessions untouched.
        if (r.checkboxChecked) setConfirmExitOnQuit?.(false).catch(console.error);
        proceed();
      })
      .catch((err) => { console.error(err); proceed(); });
    return;
  }

  proceed();
});
