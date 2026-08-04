import express from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { AppConfig, ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
import { SessionManager } from './services/SessionManager.js';
import { GitService } from './services/GitService.js';
import { OrderStore } from './persistence/OrderStore.js';
import { GroupStore } from './persistence/GroupStore.js';
import { ConfigStore } from './persistence/ConfigStore.js';
import { ChangelistStore } from './persistence/ChangelistStore.js';
import { CommitSelectionStore } from './persistence/CommitSelectionStore.js';
import { AgentRegistry } from './services/AgentRegistry.js';
import { AuthService } from './services/AuthService.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createFilesystemRoutes } from './routes/filesystem.js';
import { createSymbolRoutes } from './routes/symbols.js';
import { createGitRoutes } from './routes/git.js';
import { createNgrokRoutes } from './routes/ngrok.js';
import { createAuthRoutes } from './routes/auth.js';
import { NgrokService } from './services/NgrokService.js';
import { SleepPreventionService } from './services/SleepPreventionService.js';
import { KeepAwakeService } from './services/KeepAwakeService.js';
import { createKeepAwakeRoutes } from './routes/keepAwake.js';
import { UpdateService } from './services/UpdateService.js';
import { createConfigRoutes, createAgentRoutes } from './routes/config.js';
import { createUpdateRoutes } from './routes/update.js';
import { createWorktreeRoutes } from './routes/worktrees.js';
import { setupSocketHandler } from './socket/handler.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createDebugScrollRoute } from './routes/debugScroll.js';
import { createAgentSignalRoutes } from './routes/agentSignals.js';
import { getOrCreateSignalSecret } from './services/agentSignals/token.js';
import { resolveSignalBin } from './services/agentSignals/resolveBin.js';
import { registerProcessHandlers } from './process/globalHandlers.js';

registerProcessHandlers();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ARGUS_PORT || process.env.PORT) || 5401;
// Bind loopback only by default — the app is reached locally (Electron/browser) or
// via ngrok (which dials localhost), never directly over the LAN. Binding 0.0.0.0
// would expose the API to every device on the network. Power users can opt back in
// with ARGUS_HOST=0.0.0.0.
const HOST = process.env.ARGUS_HOST || '127.0.0.1';

// Injected folder picker — set by Electron host before startServer() is called.
// We keep a mutable options object so the filesystem route reads the current fn
// at request time rather than at module-evaluation time.
const _filesystemOptions: { pickFolder?: () => Promise<string | null> } = {};

export function setPickFolderFn(fn: () => Promise<string | null>): void {
  _filesystemOptions.pickFolder = fn;
}

const dataDir = (process.env.ARGUS_DATA_DIR || process.env.DATA_DIR)
  ? path.resolve(process.env.ARGUS_DATA_DIR || process.env.DATA_DIR || '')
  : path.join(os.homedir(), '.argus');

const app = express();
const httpServer = createServer(app);

const staticCorsOrigins = [
  'http://localhost:5402',
  'http://127.0.0.1:5402',
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  ...(process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : []),
];

// Dynamic CORS: allow static origins + whatever the active ngrok tunnel URL is.
// ngrokService is created below; the function captures it by reference so it sees
// the live publicUrl without needing a restart.
let ngrokService: NgrokService;
const corsOriginFn = (
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void,
) => {
  if (!origin) return cb(null, true); // same-origin / non-browser requests
  if (staticCorsOrigins.includes(origin)) return cb(null, true);
  const ngrokUrl = ngrokService?.getStatus().publicUrl;
  if (ngrokUrl && origin === ngrokUrl) return cb(null, true);
  cb(null, false);
};

app.use(cors({ origin: corsOriginFn }));
app.use(express.json({ limit: '10mb' }));

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: corsOriginFn },
});

// Config store & agent registry
const configStore = new ConfigStore(path.join(dataDir, 'config.json'));

// Live config snapshot, kept in sync so the Electron host (same process) can read
// quit-related preferences synchronously inside its `before-quit` handler.
let currentConfig: AppConfig | null = null;
function applyConfig(cfg: AppConfig): void {
  currentConfig = cfg;
  sessionManager.setPreventSleepWhileRunning(!!cfg.preventSleepWhileRunning);
}

// Quit-time getters consumed by electron/src/main.ts (in-process, no IPC).
export function getExitSessionsOnQuit(): boolean {
  return !!currentConfig?.exitSessionsOnQuit;
}
export function getConfirmExitOnQuit(): boolean {
  // Default true: confirm unless the user explicitly opted out.
  return currentConfig?.confirmExitOnQuit !== false;
}
export async function setConfirmExitOnQuit(value: boolean): Promise<void> {
  const cfg = currentConfig ?? (await configStore.load());
  const updated = { ...cfg, confirmExitOnQuit: value };
  applyConfig(updated);
  await configStore.save(updated);
}
// Name + status for every live (non-exited) session — used to populate the
// "exit all sessions" confirmation dialog.
export function getActiveSessionSummaries(): { name: string; status: string }[] {
  return sessionManager
    .getAllSessions()
    .filter((s) => s.status !== 'exited')
    .map((s) => ({ name: s.name, status: s.status }));
}
const agentRegistry = new AgentRegistry();

// One OS-level sleep blocker for the whole process, arbitrated by reason so a
// running shell, an ngrok tunnel and a manual keep-awake window cannot cancel
// each other's intent.
const sleepPrevention = new SleepPreventionService();

// Manual keep-awake window (toolbar CTA). Server-owned expiry; every transition
// is broadcast so a second window or a reloaded renderer never shows a stale
// countdown.
const keepAwakeService = new KeepAwakeService(sleepPrevention);
keepAwakeService.onChange((status) => {
  io.emit('keepawake:status', status);
});

// Session manager
const sessionManager = new SessionManager(dataDir, configStore, sleepPrevention);
sessionManager.setIo(io);

// Order store
const orderStore = new OrderStore(path.join(dataDir, 'order.json'));

// Mosaic-only order store (independent of the global session order)
const mosaicOrderStore = new OrderStore(path.join(dataDir, 'mosaic-order.json'));

// Group store
const groupStore = new GroupStore(path.join(dataDir, 'groups.json'));

// Auth service
const authService = new AuthService();
authService.setIo(io);

// Native agent-signal ingestion — mounted BEFORE the bearer-auth middleware so
// the local CLI/daemon can post without a UI token; hardened independently by
// per-session HMAC + loopback-only + a tiny body cap (plan 2026-07-22-001, R5).
const signalSecret = getOrCreateSignalSecret(path.join(dataDir, 'signal-secret'));
sessionManager.setSignalConfig(signalSecret, resolveSignalBin());
app.use('/api/agent-signals', createAgentSignalRoutes(sessionManager, () => signalSecret));

// Auth middleware — before routes
app.use(createAuthMiddleware(authService));

// Ngrok service (assigned to the var declared above for dynamic CORS)
ngrokService = new NgrokService(sleepPrevention);
ngrokService.setIo(io);
ngrokService.getAuthRequired = () => authService.enabled;
ngrokService.onDisconnect = () => authService.clearAuth();
ngrokService.onExposureChange = (exposed) => authService.setExposed(exposed);

// Git service
const gitService = new GitService();
sessionManager.setGitService(gitService);

// Changelist store
const changelistStore = new ChangelistStore();

// Commit selection store (IntelliJ-style per-change-block checkbox state)
const commitSelectionStore = new CommitSelectionStore();

// Update service
const updateService = new UpdateService();
updateService.setIo(io);

// Injected by the Electron host before startServer() — performs the brew-based
// self-update + relaunch. Forwarded to UpdateService so the apply route can use it.
export function setApplyUpdateFn(fn: import('./services/UpdateService.js').ApplyUpdateFn): void {
  updateService.setApplyUpdateFn(fn);
}

// Dev-only scroll trace sink — gated so it never exists in production builds.
// Moved behind auth so it requires a valid token when auth is active.
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/debug/scroll', createDebugScrollRoute(dataDir));
}

// Routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', persistentSessions: sessionManager.isPersistent() });
});
app.use('/api/sessions', createSessionRoutes(sessionManager, orderStore, mosaicOrderStore, groupStore, configStore));
// Pass the mutable options object directly so the filesystem route reads the current
// pickFolder fn at request time — Electron sets it via setPickFolderFn() before the
// first request arrives, and the CLI path leaves it undefined (falling through to osascript).
app.use('/api/fs', createFilesystemRoutes(sessionManager, _filesystemOptions));
app.use('/api/symbols', createSymbolRoutes(sessionManager));
app.use('/api', createGitRoutes(sessionManager, gitService, changelistStore, commitSelectionStore));
app.use('/api/ngrok', createNgrokRoutes(ngrokService, authService));
app.use('/api/keep-awake', createKeepAwakeRoutes(keepAwakeService));
app.use('/api/auth', createAuthRoutes(authService));
app.use('/api/config', createConfigRoutes(configStore, applyConfig));
app.use('/api/agents', createAgentRoutes(agentRegistry));
app.use('/api/update', createUpdateRoutes(updateService));
app.use('/api/worktrees', createWorktreeRoutes(sessionManager, gitService));

// Socket.io
setupSocketHandler(io, sessionManager, authService, updateService);

// Production static file serving
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    console.warn(`Warning: client/dist not found at ${clientDist} — running in API-only mode`);
  }
}

// 4-arg error handler — must be last middleware, after all routes
app.use(errorHandler);

// Start / shutdown — exported so the Electron host can control the lifecycle

let listenRetries = 0;
let _startReject: ((err: Error) => void) | null = null;

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE' && listenRetries < 5) {
    listenRetries++;
    console.log(`Port ${PORT} in use, retrying in 500ms… (${listenRetries}/5)`);
    setTimeout(() => httpServer.listen(PORT, HOST), 500);
  } else {
    console.error('Server error:', err);
    if (_startReject) {
      _startReject(err instanceof Error ? err : new Error(String(err)));
      _startReject = null;
    } else {
      process.exit(1);
    }
  }
});

export async function startServer(): Promise<void> {
  const startupConfig = await configStore.load();
  applyConfig(startupConfig);
  // Resolve the pty backend from config BEFORE restoring sessions (below).
  sessionManager.configureBackend(startupConfig.ptyBackend ?? 'auto');
  updateService.start();
  await new Promise<void>((resolve, reject) => {
    _startReject = reject;
    httpServer.listen(PORT, HOST, () => {
      _startReject = null;
      console.log(`Server running on ${HOST}:${PORT}`);
      const loopback = ['127.0.0.1', '::1', 'localhost'];
      if (!loopback.includes(HOST)) authService.setExposed(true);
      resolve();
    });
  });
  // Restore persisted sessions in the background. Each restored session
  // eagerly starts a recursive file watcher, which can take many seconds
  // for large/many folders (worse under a low fd ulimit) — blocking window
  // creation on this made a large session set look/act like a startup
  // crash. Clients already handle sessions arriving progressively via the
  // 'session:created' socket event, so there's no ordering requirement here.
  void sessionManager.restoreSessions().catch((err) => {
    console.error('Failed to restore sessions:', err);
  });
}

export async function shutdownServer(): Promise<void> {
  updateService.stop();
  await sessionManager.shutdown();
  await ngrokService.stop();
}

// "Quit & Stop All Sessions" path — terminates every agent instead of detaching,
// so tmux-backed sessions do NOT survive this quit. Wired to a dedicated Electron
// menu item.
export async function shutdownServerStoppingAll(): Promise<void> {
  updateService.stop();
  await sessionManager.stopAllAndShutdown();
  await ngrokService.stop();
}

// Auto-start and signal handlers — skipped when embedded in Electron
if (!process.versions.electron) {
  startServer().catch(console.error);
  process.on('SIGINT', () => { shutdownServer().then(() => process.exit(0)).catch(console.error); });
  process.on('SIGTERM', () => { shutdownServer().then(() => process.exit(0)).catch(console.error); });
}
