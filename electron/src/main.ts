import { app, dialog, ipcMain, BrowserWindow, Menu, shell, nativeImage, Notification } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { execFile, execFileSync, spawn } from 'child_process';
import { existsSync, readFileSync, appendFileSync, unlinkSync } from 'fs';
import type { UpdateProgress } from '@argus/shared';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createWindow, setAppQuitting, getWindow, showWindow, setStopAllOnQuit, getStopAllOnQuit, saveWindowState, setZoomLevel, getZoomLevel } from './window.js';
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
  /** Phase-1 found no newer version — informational, not an error. */
  upToDate?: boolean;
}

const UPDATE_TAP = 'antonioromano/argus';
const UPDATE_CASK = 'argus';

/**
 * Self-update via Homebrew, in two phases so the user gets honest feedback and
 * never a silent old-version relaunch:
 *
 *   Phase 1 (app stays OPEN, this function): pre-check brew, then trust the tap,
 *   refresh Homebrew, confirm a newer cask version exists, and download it into
 *   the local cache. Progress streams to the UI via `onProgress`. The returned
 *   promise resolves fast ("download started" or brew-missing). A background
 *   terminal outcome — download failure or already-up-to-date — is reported via
 *   `onResult` while the app stays open.
 *
 *   Phase 2 (after we quit): a detached helper waits for this process to exit,
 *   installs from the warm cache (`brew upgrade --cask argus`, fast/offline),
 *   and relaunches Argus ONLY on success. brew can't replace the running
 *   Argus.app, which is why the install is deferred to after quit.
 */
function applyBrewUpdate(
  onProgress: (progress: UpdateProgress) => void,
  onResult: (result: ApplyUpdateResult) => void,
): Promise<ApplyUpdateResult> {
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
      const log = (line: string) => {
        try { appendFileSync(logFile, line.endsWith('\n') ? line : line + '\n'); } catch { /* best-effort */ }
      };

      // Phase 1 emits @@-prefixed markers on stdout to drive the progress bar,
      // interleaved with raw brew output (which we also tee to update.log). We
      // run `brew trust` explicitly (the Homebrew 4.x untrusted-tap gate) and
      // check `brew outdated` before downloading so an up-to-date install is
      // reported honestly instead of a no-op masquerading as success.
      const phase1 = [
        `if [ -f "${lockFile}" ]; then echo "@@FAIL Another update is already running."; exit 0; fi`,
        `echo "@@PHASE trust"`,
        `brew trust ${UPDATE_TAP} 2>&1`,
        `echo "@@PHASE update"`,
        `brew update 2>&1`,
        `echo "@@PHASE check"`,
        `OUTDATED=$(brew outdated --cask ${UPDATE_CASK} 2>&1)`,
        `if [ -z "$OUTDATED" ]; then echo "@@UPTODATE"; exit 0; fi`,
        `echo "@@PHASE download"`,
        `brew fetch --cask ${UPDATE_CASK} 2>&1`,
        `FETCH_EXIT=$?`,
        `if [ "$FETCH_EXIT" != "0" ]; then echo "@@FAIL_EXIT $FETCH_EXIT"; exit 0; fi`,
        `echo "@@OK"`,
      ].join('\n');

      log(`[argus-update] ${new Date().toISOString()} phase1 start`);
      const proc = spawn(loginShell, ['-l', '-c', phase1], { stdio: ['ignore', 'pipe', 'pipe'] });

      let buf = '';
      const tail: string[] = []; // recent non-marker output, for error surfacing
      let upToDate = false;
      let failMsg: string | null = null;
      let inDownload = false;

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed.startsWith('@@')) {
          if (trimmed === '@@PHASE trust') onProgress({ phase: 'trust', label: 'Trusting tap…' });
          else if (trimmed === '@@PHASE update') onProgress({ phase: 'update', label: 'Updating Homebrew…' });
          else if (trimmed === '@@PHASE check') onProgress({ phase: 'update', label: 'Checking version…' });
          else if (trimmed === '@@PHASE download') { inDownload = true; onProgress({ phase: 'download', label: 'Downloading…' }); }
          else if (trimmed === '@@UPTODATE') upToDate = true;
          else if (trimmed === '@@OK') { /* success — handled on close */ }
          else if (trimmed.startsWith('@@FAIL_EXIT')) failMsg = tail.slice(-12).join('\n') || 'Download failed.';
          else if (trimmed.startsWith('@@FAIL')) failMsg = trimmed.replace('@@FAIL', '').trim() || 'Update failed.';
          return;
        }
        log(trimmed);
        tail.push(trimmed);
        if (tail.length > 40) tail.shift();
        // brew/curl download progress, e.g. "######           45.0%" or "45.0%".
        // Only while downloading — a stray "%" in `brew update` output must not move the bar.
        if (!inDownload) return;
        const m = trimmed.match(/(\d{1,3}(?:\.\d+)?)%/);
        if (m) {
          const pct = Math.max(0, Math.min(100, parseFloat(m[1])));
          onProgress({ phase: 'download', label: `Downloading ${Math.round(pct)}%`, percent: pct });
        }
      };

      // Split on BOTH \n and \r: brew/curl render the download meter as a single
      // line updated in place with carriage returns, so percent ticks only arrive
      // as \r-delimited fragments. Splitting on \n alone would buffer the whole
      // download into one chunk and the bar could never climb.
      const pump = (chunk: Buffer) => {
        buf += chunk.toString();
        let i: number;
        while ((i = buf.search(/[\r\n]/)) !== -1) {
          handleLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      };
      proc.stdout?.on('data', pump);
      proc.stderr?.on('data', pump);

      proc.on('error', (e) => {
        log(`[argus-update] phase1 spawn error: ${e.message}`);
        onResult({ success: false, error: 'Could not start Homebrew. Update via the GitHub release link below.' });
      });

      proc.on('close', () => {
        if (buf.trim()) handleLine(buf); // flush trailing partial line
        if (upToDate) {
          log('[argus-update] already up to date');
          onResult({ success: false, upToDate: true, error: 'Argus is already up to date — no newer version to install.' });
          return;
        }
        if (failMsg) {
          log(`[argus-update] phase1 failed: ${failMsg}`);
          onResult({ success: false, error: failMsg });
          return;
        }
        // Download succeeded → Phase 2: install from cache after we quit.
        onProgress({ phase: 'install', label: 'Installing… Argus will relaunch.' });
        startPhase2(loginShell, logFile, lockFile);
        setTimeout(() => {
          setAppQuitting(true);
          app.quit();
        }, 500);
      });

      // Resolve fast: the download has started; the UI follows progress events.
      resolve({ success: true });
    });
  });
}

/**
 * Phase 2 helper: spawned detached just before we quit. Waits for this process
 * to exit, installs the already-downloaded cask from cache, and relaunches Argus
 * only on success. A lock file prevents the relaunched app from re-triggering
 * the loop; a `.failed` marker lets the next launch surface a failed install.
 */
function startPhase2(loginShell: string, logFile: string, lockFile: string): void {
  const failMarker = join(app.getPath('userData'), 'update.failed');
  const script = [
    `if [ -f "${lockFile}" ]; then echo "[argus-update] phase2 already running, exiting" >> "${logFile}"; exit 0; fi`,
    `echo $$ > "${lockFile}"`,
    `rm -f "${failMarker}"`,
    `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done`,
    `echo "[argus-update] $(date) phase2 install" >> "${logFile}"`,
    `brew upgrade --cask ${UPDATE_CASK} >> "${logFile}" 2>&1`,
    `BREW_EXIT=$?`,
    `rm -f "${lockFile}"`,
    `if [ $BREW_EXIT -eq 0 ]; then`,
    `  echo "[argus-update] $(date) install ok, relaunching" >> "${logFile}"`,
    `  open -a Argus`,
    `else`,
    `  echo "[argus-update] $(date) install failed (exit $BREW_EXIT)" >> "${logFile}"`,
    `  echo "$BREW_EXIT" > "${failMarker}"`,
    `  open -a Argus`,
    `fi`,
  ].join('\n');

  const child = spawn(loginShell, ['-l', '-c', script], { detached: true, stdio: 'ignore' });
  child.unref();
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
      // Custom click handlers (not built-in roles) so every change routes through
      // setZoomLevel and keeps the tracked level in sync — survives reload.
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => setZoomLevel(0) },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => setZoomLevel(getZoomLevel() + 0.5) },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => setZoomLevel(getZoomLevel() - 0.5) },
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
    // Anchor to `//` after http(s) — `https:` alone (no slashes) would also
    // match a bare `/^https?:/`, letting a crafted `https:evil` string through.
    if (/^(https?:\/\/|mailto:)/.test(url)) shell.openExternal(url);
  });

  // Relaunch to apply a startup-only setting (e.g. the pty backend switch).
  ipcMain.on('app:relaunch', () => {
    app.relaunch();
    app.exit(0);
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
        // Bind the notification to Argus's bundle id so its CLICK activation
        // routes to Argus. Without -sender, terminal-notifier 2.0.0 exits right
        // after posting, and a click RELAUNCHES it with no activation target —
        // it then falls back to its historical default sender, Terminal.app,
        // which is why a stray Terminal window popped open on every click.
        // Packaged only: in dev the running app is Electron, not the installed
        // com.antonio.argus bundle, so -sender would activate the wrong app.
        ...(app.isPackaged ? ['-sender', 'com.antonio.argus'] : []),
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

  // Surface a failed Phase-2 install from the previous run: if the cache install
  // errored after we quit, the helper relaunched the OLD version and left a
  // marker. Tell the user honestly instead of pretending the update succeeded.
  surfaceFailedInstall();
}

/** Show + clear the Phase-2 install-failure marker written by startPhase2. */
function surfaceFailedInstall(): void {
  const failMarker = join(app.getPath('userData'), 'update.failed');
  if (!existsSync(failMarker)) return;
  let exitCode = '';
  try { exitCode = readFileSync(failMarker, 'utf8').trim(); } catch { /* ignore */ }
  const logFile = join(app.getPath('userData'), 'update.log');
  void dialog.showMessageBox({
    type: 'warning',
    title: 'Argus — Update did not install',
    message: 'The latest version was downloaded but Homebrew could not install it.',
    detail: `Argus reopened the previous version.${exitCode ? ` (brew exit ${exitCode})` : ''}\n\nTry the update again, or run "brew upgrade --cask argus" in a terminal.\nDetails: ${logFile}`,
    buttons: ['OK'],
  });
  try { unlinkSync(failMarker); } catch { /* best-effort */ }
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

// Resolve the tmux binary the same way PtyManager does (server/src/services/
// PtyManager.ts resolveTmux): ARGUS_TMUX_PATH override → binary bundled in the
// packaged .app → system tmux on PATH. null means no tmux to kill.
function resolveTmuxBinary(): string | null {
  if (process.env.ARGUS_TMUX_PATH) return process.env.ARGUS_TMUX_PATH;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const bundled = join(resourcesPath, 'tmux', `tmux-${process.arch}`);
    try {
      if (existsSync(bundled)) return bundled;
    } catch {
      /* ignore */
    }
  }
  try {
    const which = execFileSync('which', ['tmux'], { encoding: 'utf-8' }).trim();
    if (which) return which;
  } catch {
    /* tmux not on PATH */
  }
  return null;
}

// Best-effort escalation when graceful stop-all times out: force-kill Argus's
// isolated tmux server so a stuck shutdown can't leave orphaned tmux + pty
// processes running after Argus itself quits. The socket name matches
// PtyManager's `TMUX_SOCKET` (ARGUS_TMUX_SOCKET || 'argus') — set per-mode at
// startup ('argus-dev' for dev, 'argus'/app name for packaged) so this only
// ever kills THIS instance's server, never a sibling install's. Never throws:
// tmux already dead / no server running / binary missing must not block quit.
function killTmuxServerBestEffort(): void {
  try {
    const tmuxBin = resolveTmuxBinary();
    if (!tmuxBin) return;
    const socket = process.env.ARGUS_TMUX_SOCKET || 'argus';
    execFileSync(tmuxBin, ['-L', socket, 'kill-server'], { timeout: 3000, stdio: 'ignore' });
    console.warn(`[electron] force-killed tmux server (-L ${socket}) after shutdown timeout`);
  } catch {
    // Swallow — best-effort cleanup; the quit must proceed regardless.
  }
}

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
      // Graceful stop-all didn't finish in time: only stop-all quits promise to
      // terminate agents, so escalate by force-killing the tmux server rather
      // than leaving orphaned tmux + pty processes behind. (Default detach-quit
      // intentionally keeps the server alive, so don't kill it there.)
      if (wantStopAll) killTmuxServerBestEffort();
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
