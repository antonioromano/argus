import express from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type {
  AppConfig,
  ClientToServerEvents,
  ServerToClientEvents,
  SessionInfo,
  ValidatedLaunch,
  WindowRegistryState,
} from '@argus/shared';
import { SessionManager } from './services/SessionManager.js';
import { GitService } from './services/GitService.js';
import { PrStatusService } from './services/PrStatusService.js';
import { isBetaEnabled } from './utils/betaFlags.js';
import { createHandoffRoutes } from './routes/handoff.js';
import { createTemplateRoutes } from './routes/templates.js';
import { TemplateStore } from './persistence/TemplateStore.js';
import { ChainStore } from './persistence/ChainStore.js';
import { ChainEngine } from './services/chains/ChainEngine.js';
import { createChainRoutes } from './routes/chains.js';
import { createActivityRoutes } from './routes/activity.js';
import { cleanupOldHandoffs, typeWhenReady } from './services/handoff.js';
import { BROADCAST_ENTER_DELAY_MS, SessionInputQueue } from './socket/broadcast.js';
import { OrderStore } from './persistence/OrderStore.js';
import { GroupStore } from './persistence/GroupStore.js';
import { WindowStore } from './persistence/WindowStore.js';
import { WindowRegistry } from './services/WindowRegistry.js';
import { createWindowRoutes, type WindowHostHooks } from './routes/windows.js';
import { ConfigStore } from './persistence/ConfigStore.js';
import { ChangelistStore } from './persistence/ChangelistStore.js';
import { CommitSelectionStore } from './persistence/CommitSelectionStore.js';
import { AgentRegistry } from './services/AgentRegistry.js';
import { LauncherStore } from './persistence/LauncherStore.js';
import { LaunchService } from './services/launch/LaunchService.js';
import { AuthService } from './services/AuthService.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createFilesystemRoutes } from './routes/filesystem.js';
import { createSymbolRoutes } from './routes/symbols.js';
import { createGitRoutes } from './routes/git.js';
import { createNgrokRoutes } from './routes/ngrok.js';
import { createAuthRoutes } from './routes/auth.js';
import { createAutoApprovalRoutes } from './routes/autoApproval.js';
import { AutoApprovalStore } from './persistence/AutoApprovalStore.js';
import { AutoApprovalService } from './services/autoApproval/AutoApprovalService.js';
import { NgrokService } from './services/NgrokService.js';
import { SleepPreventionService } from './services/SleepPreventionService.js';
import { KeepAwakeService } from './services/KeepAwakeService.js';
import { createKeepAwakeRoutes } from './routes/keepAwake.js';
import { isPlanPartOn } from './utils/usageMeter.js';
import { OrphanJanitor } from './services/OrphanJanitor.js';
import { createMaintenanceRoutes } from './routes/maintenance.js';
import { UpdateService } from './services/UpdateService.js';
import { createConfigRoutes, createAgentRoutes } from './routes/config.js';
import { createUpdateRoutes } from './routes/update.js';
import { createWorktreeRoutes } from './routes/worktrees.js';
import { createSearchRoutes } from './routes/search.js';
import { setupSocketHandler } from './socket/handler.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createChatImageRoutes } from './routes/chatImages.js';
import { createOriginGuard } from './middleware/originGuard.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createJsonBodyParser } from './middleware/bodyParsers.js';
import { createDebugScrollRoute } from './routes/debugScroll.js';
import { createAgentSignalRoutes } from './routes/agentSignals.js';
import { getOrCreateSignalSecret } from './services/agentSignals/token.js';
import { resolveSignalBin } from './services/agentSignals/resolveBin.js';
import { registerProcessHandlers } from './process/globalHandlers.js';
import { scrubParentAgentEnv } from './utils/scrubParentAgentEnv.js';

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

// Before anything spawns: an Argus started from a Claude Code terminal must not
// pass that session's markers to its own agents (see scrubParentAgentEnv).
const scrubbedEnv = scrubParentAgentEnv();
if (scrubbedEnv.length > 0) console.log(`[env] dropped inherited Claude session markers: ${scrubbedEnv.join(', ')}`);

const dataDir = (process.env.ARGUS_DATA_DIR || process.env.DATA_DIR)
  ? path.resolve(process.env.ARGUS_DATA_DIR || process.env.DATA_DIR || '')
  : path.join(os.homedir(), '.argus');

const app = express();
// Must precede the first app.use (the app router reads it once, lazily). Routing
// was case-insensitive, so `/API/sessions` matched the sessions route while the
// auth middleware's `startsWith('/api/')` let it through unauthenticated.
app.set('case sensitive routing', true);
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

// Reject (not just un-header) untrusted Host/Origin before anything runs: see
// originGuard for the cross-site WebSocket / DNS-rebinding hole it closes.
const originGuard = createOriginGuard({
  staticOrigins: staticCorsOrigins,
  tunnelUrl: () => ngrokService?.getStatus().publicUrl ?? undefined,
});
app.use(originGuard.middleware);
app.use(cors({ origin: corsOriginFn }));
// Per-route limits (fs writes, agent signals) only hold if this skips them.
app.use(createJsonBodyParser());

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: corsOriginFn },
  // engine.io never checks Origin on a WebSocket upgrade; this does.
  allowRequest: originGuard.allowRequest,
});

// Config store & agent registry
const configStore = new ConfigStore(path.join(dataDir, 'config.json'));

// Live config snapshot, kept in sync so the Electron host (same process) can read
// quit-related preferences synchronously inside its `before-quit` handler.
let currentConfig: AppConfig | null = null;
function applyConfig(cfg: AppConfig): void {
  currentConfig = cfg;
  sessionManager.setPreventSleepWhileRunning(!!cfg.preventSleepWhileRunning);
  sessionManager.setPrStatusEnabled(cfg.showPrStatus !== false);
  sessionManager.setWorktreeLifecycleEnabled(isBetaEnabled(cfg, 'betaWorktreeLifecycle'));
  sessionManager.setActivityTimelineEnabled(isBetaEnabled(cfg, 'betaActivityTimeline'));
  sessionManager.setUsageMeterConfig({ enabled: cfg.showUsageMeter !== false, plan: isPlanPartOn(cfg) });
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
export function getConfirmQuitDirectSessions(): boolean {
  return currentConfig?.confirmQuitDirectSessions !== false;
}
export async function setConfirmQuitDirectSessions(value: boolean): Promise<void> {
  const cfg = currentConfig ?? (await configStore.load());
  const updated = { ...cfg, confirmQuitDirectSessions: value };
  applyConfig(updated);
  await configStore.save(updated);
}
// Name, status, engine and run mode for every live (non-exited) session — used
// to populate the "exit all sessions" and "stop direct sessions" quit
// confirmation dialogs, which label each one so it is clear what is about to
// be stopped.
export function getActiveSessionSummaries(): { name: string; status: string; terminalEngine?: string; runMode?: 'persistent' | 'direct' }[] {
  return sessionManager
    .getAllSessions()
    .filter((s) => s.status !== 'exited')
    .map((s) => ({ name: s.name, status: s.status, terminalEngine: s.terminalEngine, runMode: s.runMode ?? 'persistent' }));
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

// Window registry — source of truth for multi-window ownership.
const windowStore = new WindowStore(path.join(dataDir, 'windows.json'));
const windowRegistry = new WindowRegistry(windowStore);
windowRegistry.onChange((state) => io.emit('window:state', state));
sessionManager.onSessionDeleted = (id) => {
  void windowRegistry.removeSession(id).catch(console.error);
  chainEngine.handleSessionRemoved(id);
};

// Deep-link launchers (argus://run/<id>) — own file, never via PUT /api/config.
const launcherStore = new LauncherStore(path.join(dataDir, 'launchers.json'));
const launchService = new LaunchService({
  store: launcherStore,
  loadConfig: () => configStore.load(),
  agentRegistry,
  home: os.homedir(),
  findLiveByLauncher: (id) => sessionManager.findLiveByLauncher(id),
});
/** In-process only (Electron main). There is deliberately no REST route. */
export function getLaunchService(): LaunchService {
  return launchService;
}
/** Create a session from an approved/ready launch and give it to `windowId`. */
export async function hostLaunch(v: ValidatedLaunch, windowId: string, launcherId?: string): Promise<SessionInfo> {
  const r = v.request;
  const session = await sessionManager.createSession(
    r.folder, r.name, r.agent, r.flags, undefined, undefined, r.worktree, r.base, false, r.engine, r.mode, false,
    { initialPrompt: r.prompt, launcherId },
  );
  await windowRegistry.assign(session.id, windowId);
  return session;
}
let sessionsRestored: Promise<void> = Promise.resolve();
/** Resolves once restoreSessions (started in the background by startServer) settles. */
export function whenSessionsRestored(): Promise<void> {
  return sessionsRestored;
}

// Electron host callbacks — mutable so the host can set them before/after
// startServer (same pattern as _filesystemOptions).
const _windowHooks: WindowHostHooks = {};
export function setWindowHooks(h: WindowHostHooks): void {
  Object.assign(_windowHooks, h);
}
/** The in-process SessionManager, for Electron main to wire the native terminal
 *  host. Main runs the server in-process (electron/src/main.ts:515), so this is
 *  a direct reference — no socket hop. */
export function getSessionManager(): SessionManager {
  return sessionManager;
}
export function getWindowRegistryState(): WindowRegistryState {
  return windowRegistry.getState();
}
// In-process entry points for the Electron host (menu items, red-button close).
export async function hostCreateWindow(): Promise<void> {
  const win = await windowRegistry.createWindow();
  _windowHooks.onCreate?.(win.id);
}
export async function hostDeleteWindow(id: string): Promise<void> {
  if (await windowRegistry.deleteWindow(id)) _windowHooks.onClose?.(id);
}
export async function hostMergeAll(targetId: string): Promise<void> {
  const removed = await windowRegistry.mergeAll(
    targetId,
    sessionManager.getAllSessions().map((s) => s.id),
  );
  for (const id of removed ?? []) _windowHooks.onClose?.(id);
}
/**
 * Main-window red-button close. With no secondaries → null (Electron hides
 * main, today's behavior). Otherwise the oldest secondary takes over the
 * main role (registry-side: label transfers, its record dissolves) and its
 * old window id is returned so Electron can adopt its BrowserWindow as main.
 * No onClose hook fires — the promoted BrowserWindow lives on.
 */
export async function hostCloseMainRequest(): Promise<string | null> {
  const target = windowRegistry.oldestSecondary();
  if (!target) return null;
  const ok = await windowRegistry.promote(target.id);
  return ok ? target.id : null;
}

// Auth service
const authService = new AuthService();
authService.setIo(io);

// Native agent-signal ingestion — mounted BEFORE the bearer-auth middleware so
// the local CLI/daemon can post without a UI token; hardened independently by
// per-session HMAC + loopback-only + a tiny body cap (plan 2026-07-22-001, R5).
const signalSecret = getOrCreateSignalSecret(path.join(dataDir, 'signal-secret'));
sessionManager.setSignalConfig(signalSecret, resolveSignalBin());
// F5 auto-approval: rules live in the data dir (never a session folder), the
// decision is made here from the session table, and the global switch is the
// live config. Until the store has loaded it holds no rules, so nothing is allowed.
const autoApprovalStore = new AutoApprovalStore(path.join(dataDir, 'auto-approval.json'));
autoApprovalStore.load().catch((err) => console.warn('[autoApproval] store load failed:', err));
const autoApprovalService = new AutoApprovalService({
  store: autoApprovalStore,
  isEnabled: () => currentConfig?.autoApprovalEnabled === true,
  getSession: (id) => sessionManager.getSessionInfo(id),
});
app.use('/api/agent-signals', createAgentSignalRoutes(
  sessionManager,
  () => signalSecret,
  (sessionId, hook) => autoApprovalService.decide(sessionId, hook),
));

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
const prStatusService = new PrStatusService({
  headInfo: (folder) => gitService.headInfo(folder),
  defaultBranch: (root) => gitService.getDefaultBranch(root),
});
sessionManager.setPrStatusService(prStatusService);

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
// Beta F6 activity timeline: GET /api/sessions/:id/activity (404 while the flag is off).
app.use('/api/sessions', createActivityRoutes({
  isEnabled: () => isBetaEnabled(currentConfig, 'betaActivityTimeline'),
  getActivity: (id) => sessionManager.getActivity(id),
}));
// Beta F12 agent handoff: POST /api/sessions/:id/handoff (404 while the flag is off).
const handoffDir = path.join(dataDir, 'handoffs');
// One input queue for every in-process writer and the socket handler: a typed
// prompt's text and its delayed Enter never interleave with keystrokes.
const sharedInputQueue = new SessionInputQueue((id, data) => sessionManager.writeToSession(id, data));
app.use('/api/sessions', createHandoffRoutes({
  isEnabled: () => isBetaEnabled(currentConfig, 'betaHandoff'),
  handoffDir,
  loadConfig: () => configStore.load(),
  agentRegistry,
  manager: sessionManager,
  createSession: (folder, name, agentType, flags, initialPrompt) => sessionManager.createSession(
    folder, name, agentType, flags, undefined, undefined, undefined, undefined, false, undefined, undefined, false,
    initialPrompt !== undefined ? { initialPrompt } : {},
  ),
  typePrompt: (id, text) => typeWhenReady(id, text, {
    status: (sid) => sessionManager.getSessionInfo(sid)?.status,
    write: (sid, data, pause) => sharedInputQueue.write(sid, data, pause),
    enterDelayMs: BROADCAST_ENTER_DELAY_MS,
  }),
}));
app.use('/api/sessions', createSessionRoutes(sessionManager, orderStore, mosaicOrderStore, groupStore, configStore));
// B1 Chat view: clipboard images pasted in the composer, saved to a private temp dir.
app.use('/api/sessions', createChatImageRoutes({
  isChatSession: (id) => sessionManager.getSessionInfo(id)?.agentType === 'claude',
}));
// Beta F10 session templates: /api/templates CRUD + launch (404 while the flag is off).
// Own file (templates.json), never config.json; deliberately no deep-link path.
app.use('/api/templates', createTemplateRoutes({
  isEnabled: () => isBetaEnabled(currentConfig, 'betaSessionTemplates'),
  store: new TemplateStore(path.join(dataDir, 'templates.json')),
  groupStore,
  loadConfig: () => configStore.load(),
  agentRegistry,
  createSession: (spec, name, flags) => sessionManager.createSession(
    spec.folder, name, spec.agent, flags, undefined, undefined, spec.worktreeBranch, undefined, false, undefined, undefined, false,
    spec.prompt !== undefined ? { initialPrompt: spec.prompt } : {},
  ),
  assignWindow: (sessionId, windowId) => windowRegistry.assign(sessionId, windowId),
  onGroupsChanged: () => io.emit('groups:changed'),
}));
// Beta F13 session chains: /api/chains (404 while the flag is off). Delivery
// goes through sharedInputQueue, like keystrokes and broadcasts.
const chainEngine = new ChainEngine({
  isEnabled: () => isBetaEnabled(currentConfig, 'betaSessionChains'),
  store: new ChainStore(path.join(dataDir, 'chains.json')),
  session: (id) => {
    const s = sessionManager.getSession(id);
    return s ? { status: s.status, agentType: s.agentType, name: s.name, menuOpen: !!s.promptOptions?.length } : undefined;
  },
  write: (id, data, pause) => sharedInputQueue.write(id, data, pause),
  inputPending: (id) => sharedInputQueue.isPending(id),
  enterDelayMs: BROADCAST_ENTER_DELAY_MS,
  onChange: () => io.emit('chains:changed'),
});
sessionManager.onStatus((id, status) => chainEngine.handleStatus(id, status));
app.use('/api/chains', createChainRoutes({
  isEnabled: () => isBetaEnabled(currentConfig, 'betaSessionChains'),
  engine: chainEngine,
}));
// Pass the mutable options object directly so the filesystem route reads the current
// pickFolder fn at request time — Electron sets it via setPickFolderFn() before the
// first request arrives, and the CLI path leaves it undefined (falling through to osascript).
app.use('/api/fs', createFilesystemRoutes(sessionManager, _filesystemOptions));
app.use('/api/symbols', createSymbolRoutes(sessionManager));
app.use('/api', createGitRoutes(sessionManager, gitService, changelistStore, commitSelectionStore));
app.use('/api/ngrok', createNgrokRoutes(ngrokService, authService));
app.use('/api/keep-awake', createKeepAwakeRoutes(keepAwakeService));
// Plan usage per agent account (the usage meter); live updates ride `usage:plan`.
app.get('/api/usage/plan', (_req, res) => {
  res.json(sessionManager.getPlanUsage());
});
app.use('/api/maintenance', createMaintenanceRoutes(new OrphanJanitor({
  context: () => {
    const active = sessionManager.activeBackend();
    let activeDaemonPid: number | null = null;
    if (active.socketPath) {
      try {
        const pid = Number.parseInt(fs.readFileSync(`${active.socketPath}.pid`, 'utf-8').trim(), 10);
        if (Number.isInteger(pid) && pid > 0) activeDaemonPid = pid;
      } catch { /* daemon not up yet: the socket match still protects it */ }
    }
    return {
      dataDir,
      activeSocket: active.socketPath,
      activeDaemonPid,
      tmuxLabel: process.env.ARGUS_TMUX_SOCKET || 'argus',
      tmuxActive: active.kind === 'tmux',
      selfPid: process.pid,
    };
  },
})));
app.use('/api/auth', createAuthRoutes(authService));
app.use('/api/config', createConfigRoutes(configStore, applyConfig));
app.use('/api/auto-approval', createAutoApprovalRoutes({
  store: autoApprovalStore,
  service: autoApprovalService,
  listSessions: () => sessionManager.getAllSessions(),
}));
app.use('/api/agents', createAgentRoutes(agentRegistry));
app.use('/api/update', createUpdateRoutes(updateService));
app.use('/api/worktrees', createWorktreeRoutes(sessionManager, gitService, {
  isEnabled: () => isBetaEnabled(currentConfig, 'betaWorktreeLifecycle'),
  prService: prStatusService,
}));
app.use('/api/search', createSearchRoutes({ targets: () => sessionManager.searchTargets() }));
app.use('/api/windows', createWindowRoutes(
  windowRegistry,
  () => sessionManager.getAllSessions().map((s) => s.id),
  _windowHooks,
));

// Socket.io
setupSocketHandler(io, sessionManager, authService, updateService, {
  inputQueue: sharedInputQueue,
  onUserInput: (id) => chainEngine.noteUserInput(id),
});

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
  await windowRegistry.init();
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
  // Handoff briefs (beta F12) are single-use; drop week-old ones.
  void cleanupOldHandoffs(handoffDir).then((n) => {
    if (n > 0) console.log(`[handoff] removed ${n} old brief(s)`);
  });
  sessionsRestored = sessionManager
    .restoreSessions()
    .then(async () => {
      const ids = new Set(sessionManager.getAllSessions().map((s) => s.id));
      await windowRegistry.pruneToSessions(ids);
      // Beta F13: chains whose source or target did not come back are dropped.
      await chainEngine.init((id) => ids.has(id));
    })
    .catch((err) => {
      console.error('Failed to restore sessions:', err);
      void chainEngine.init((id) => !!sessionManager.getSession(id)).catch(console.error);
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
