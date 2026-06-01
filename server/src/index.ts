import express from 'express';
import cors from 'cors';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';
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
import { createGitRoutes } from './routes/git.js';
import { createNgrokRoutes } from './routes/ngrok.js';
import { createAuthRoutes } from './routes/auth.js';
import { NgrokService } from './services/NgrokService.js';
import { UpdateService } from './services/UpdateService.js';
import { createConfigRoutes, createAgentRoutes } from './routes/config.js';
import { createUpdateRoutes } from './routes/update.js';
import { createWorktreeRoutes } from './routes/worktrees.js';
import { setupSocketHandler } from './socket/handler.js';
import { createAuthMiddleware } from './middleware/auth.js';

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
const agentRegistry = new AgentRegistry();

// Session manager
const sessionManager = new SessionManager(dataDir, configStore);
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

// Auth middleware — before routes
app.use(createAuthMiddleware(authService));

// Ngrok service (assigned to the var declared above for dynamic CORS)
ngrokService = new NgrokService();
ngrokService.setIo(io);
ngrokService.getAuthRequired = () => authService.enabled;
ngrokService.onDisconnect = () => authService.clearAuth();

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

// Routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', persistentSessions: sessionManager.isPersistent() });
});
app.use('/api/sessions', createSessionRoutes(sessionManager, orderStore, mosaicOrderStore, groupStore, configStore));
// Pass the mutable options object directly so the filesystem route reads the current
// pickFolder fn at request time — Electron sets it via setPickFolderFn() before the
// first request arrives, and the CLI path leaves it undefined (falling through to osascript).
app.use('/api/fs', createFilesystemRoutes(sessionManager, _filesystemOptions));
app.use('/api', createGitRoutes(sessionManager, gitService, changelistStore, commitSelectionStore));
app.use('/api/ngrok', createNgrokRoutes(ngrokService, authService));
app.use('/api/auth', createAuthRoutes(authService));
app.use('/api/config', createConfigRoutes(configStore));
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

// Start / shutdown — exported so the Electron host can control the lifecycle

let listenRetries = 0;
httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE' && listenRetries < 5) {
    listenRetries++;
    console.log(`Port ${PORT} in use, retrying in 500ms… (${listenRetries}/5)`);
    setTimeout(() => httpServer.listen(PORT, HOST), 500);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});

export async function startServer(): Promise<void> {
  await sessionManager.restoreSessions();
  updateService.start();
  return new Promise((resolve) => {
    httpServer.listen(PORT, HOST, () => {
      console.log(`Server running on ${HOST}:${PORT}`);
      resolve();
    });
  });
}

export async function shutdownServer(): Promise<void> {
  updateService.stop();
  await sessionManager.shutdown();
  await ngrokService.stop();
}

// "Quit & Stop All Sessions" path — terminates every agent instead of detaching,
// so tmux-backed sessions do NOT survive this quit. Wired to a dedicated Electron
// menu item / tray entry.
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
