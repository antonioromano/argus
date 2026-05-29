import { v4 as uuidv4 } from 'uuid';
import { access, mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import os from 'os';
import type { IPty } from 'node-pty';
import type { Server } from 'socket.io';
import type {
  SessionInfo,
  SessionStatus,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@argus/shared';
import { PtyManager } from './PtyManager.js';
import { StateDetector } from './StateDetector.js';
import { SessionStore, type PersistedSession } from '../persistence/SessionStore.js';
import { ConfigStore } from '../persistence/ConfigStore.js';
import { AgentRegistry } from './AgentRegistry.js';
import { CompanionTerminalManager } from './CompanionTerminalManager.js';
import { cleanupSessionDimensions } from '../socket/handler.js';
import type { GitService } from './GitService.js';

interface ManagedSession {
  id: string;
  name: string;
  folderPath: string;
  agentType: string;
  flags: string[];
  status: SessionStatus;
  createdAt: string;
  pty: IPty;
  stateDetector: StateDetector;
  outputBuffer: string;
  worktreePath?: string;
  worktreeBranch?: string;
  lastPrompt?: string;
}

const GIT_POLL_INTERVAL_MS = 10_000;

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private ptyManager = new PtyManager();
  private agentRegistry = new AgentRegistry();
  readonly companionTerminals = new CompanionTerminalManager();
  private store: SessionStore;
  private configStore: ConfigStore;
  private io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
  private gitService: GitService | null = null;
  private gitDirtyMap = new Map<string, boolean>();
  private gitPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(dataDir: string, configStore: ConfigStore) {
    this.store = new SessionStore(path.join(dataDir, 'sessions.json'));
    this.configStore = configStore;
  }

  setIo(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
    this.io = io;
  }

  setGitService(gitService: GitService): void {
    this.gitService = gitService;
    this.gitPollTimer = setInterval(() => this.pollGitStatus(), GIT_POLL_INTERVAL_MS);
  }

  private async pollGitStatus(): Promise<void> {
    if (!this.gitService) return;
    for (const session of this.sessions.values()) {
      if (session.status === 'exited') continue;
      try {
        const dirty = await this.gitService.hasChanges(session.folderPath);
        const prev = this.gitDirtyMap.get(session.id);
        if (dirty !== prev) {
          this.gitDirtyMap.set(session.id, dirty);
          this.io?.emit('session:gitStatus', { sessionId: session.id, hasGitChanges: dirty });
        }
      } catch {
        // non-git folder or git unavailable — ignore
      }
    }
  }

  async createSession(folderPath: string, name?: string, agentType?: string, flags?: string[], existingId?: string, existingCreatedAt?: string, worktreeBranch?: string, worktreeBase?: string): Promise<SessionInfo> {
    let effectiveFolderPath = folderPath;
    let worktreePath: string | undefined;

    if (worktreeBranch) {
      if (existingId) {
        // Restoring a worktree session — folderPath IS the worktree dir (already exists on disk)
        worktreePath = folderPath;
        effectiveFolderPath = folderPath;
        await access(effectiveFolderPath);
      } else {
        // New worktree session — validate repo exists, then create worktree
        await access(folderPath);
        if (!this.gitService) throw new Error('GitService not available for worktree creation');
        // Validate branch name: no leading dash, no path traversal, git-safe chars only
        if (!/^(?!-)[A-Za-z0-9._/-]+$/.test(worktreeBranch) || worktreeBranch.includes('..')) {
          throw new Error('Invalid worktree branch name');
        }

        const gitRoot = await this.gitService.getGitRoot(folderPath);
        const hash = createHash('sha256').update(gitRoot).digest('hex').slice(0, 6);
        const slug = `${path.basename(gitRoot)}-${hash}`;
        const WORKTREES_BASE = path.join(os.homedir(), '.argus', 'worktrees');
        worktreePath = path.resolve(path.join(WORKTREES_BASE, slug, worktreeBranch));
        if (!worktreePath.startsWith(WORKTREES_BASE + path.sep)) {
          throw new Error('Invalid worktree branch name');
        }

        // Enforce one active session per worktree
        for (const session of this.sessions.values()) {
          if (session.status !== 'exited' && session.folderPath === worktreePath) {
            throw new Error(`A live session already uses worktree "${worktreeBranch}". Close it first.`);
          }
        }

        await mkdir(path.dirname(worktreePath), { recursive: true });
        await this.gitService.worktreeAdd(gitRoot, worktreePath, worktreeBranch, worktreeBase ?? 'HEAD');
        effectiveFolderPath = worktreePath;
      }
    } else {
      // Non-worktree session
      await access(folderPath);
    }

    // Resolve agent type: explicit > config default > 'claude'
    const config = await this.configStore.load();
    const resolvedAgentType = agentType || config.defaultAgent || 'claude';

    // Resolve the CLI command for this agent
    const agentDef = this.agentRegistry.getById(resolvedAgentType, config.customAgents);
    const command = agentDef?.command ?? resolvedAgentType;

    const id = existingId ?? uuidv4();
    const sessionName = name || path.basename(effectiveFolderPath);
    const createdAt = existingCreatedAt ?? new Date().toISOString();

    const stateDetector = new StateDetector((status) => {
      const session = this.sessions.get(id);
      if (session) {
        session.status = status;
        if (status === 'waiting') {
          session.lastPrompt = session.stateDetector.getLastPromptText();
        } else {
          session.lastPrompt = undefined;
        }
        this.io?.to(id).emit('session:status', { sessionId: id, status, lastPrompt: session.lastPrompt });
      }
    }, resolvedAgentType);

    const resolvedFlags = flags || [];
    const ptyProcess = this.ptyManager.spawn(effectiveFolderPath, command, 120, 30, resolvedFlags);

    const session: ManagedSession = {
      id,
      name: sessionName,
      folderPath: effectiveFolderPath,
      agentType: resolvedAgentType,
      flags: resolvedFlags,
      status: 'running',
      createdAt,
      pty: ptyProcess,
      stateDetector,
      outputBuffer: '',
      worktreePath,
      worktreeBranch,
    };

    ptyProcess.onData((data) => {
      // Buffer output for replay on reconnect
      session.outputBuffer += data;
      if (session.outputBuffer.length > 100_000) {
        session.outputBuffer = session.outputBuffer.slice(-100_000);
      }
      stateDetector.feed(data);
      this.io?.to(id).emit('session:output', { sessionId: id, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      stateDetector.setExited();
      this.io?.to(id).emit('session:exit', { sessionId: id, exitCode });
    });

    this.sessions.set(id, session);
    await this.persistSessions();

    const info = this.toSessionInfo(session);
    this.io?.emit('session:created', info);
    return info;
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);

    session.stateDetector.destroy();
    this.ptyManager.kill(session.pty);
    this.companionTerminals.kill(id);
    this.sessions.delete(id);
    this.gitDirtyMap.delete(id);
    cleanupSessionDimensions(id);
    await this.persistSessions();

    this.io?.emit('session:deleted', { sessionId: id });
  }

  async restartSession(id: string): Promise<SessionInfo> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);

    // Tear down old pty and companion terminal
    session.stateDetector.destroy();
    this.ptyManager.kill(session.pty);
    this.companionTerminals.kill(id);

    // Reset state
    session.outputBuffer = '';
    session.status = 'running';

    // Resolve agent command
    const config = await this.configStore.load();
    const agentDef = this.agentRegistry.getById(session.agentType, config.customAgents);
    const command = agentDef?.command ?? session.agentType;

    // New state detector wired to same id
    const stateDetector = new StateDetector((status) => {
      const s = this.sessions.get(id);
      if (s) {
        s.status = status;
        if (status === 'waiting') {
          s.lastPrompt = s.stateDetector.getLastPromptText();
        } else {
          s.lastPrompt = undefined;
        }
        this.io?.to(id).emit('session:status', { sessionId: id, status, lastPrompt: s.lastPrompt });
      }
    }, session.agentType);

    // Spawn fresh pty with the same flags as the original session
    const ptyProcess = this.ptyManager.spawn(session.folderPath, command, 120, 30, session.flags);

    ptyProcess.onData((data) => {
      session.outputBuffer += data;
      if (session.outputBuffer.length > 100_000) {
        session.outputBuffer = session.outputBuffer.slice(-100_000);
      }
      stateDetector.feed(data);
      this.io?.to(id).emit('session:output', { sessionId: id, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      stateDetector.setExited();
      this.io?.to(id).emit('session:exit', { sessionId: id, exitCode });
    });

    session.pty = ptyProcess;
    session.stateDetector = stateDetector;

    this.io?.to(id).emit('session:status', { sessionId: id, status: 'running' });
    return this.toSessionInfo(session);
  }

  getSession(id: string): ManagedSession | undefined {
    return this.sessions.get(id);
  }

  getSessionInfo(id: string): SessionInfo | undefined {
    const session = this.sessions.get(id);
    return session ? this.toSessionInfo(session) : undefined;
  }

  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => this.toSessionInfo(s));
  }

  getSessionBuffer(id: string): string | undefined {
    return this.sessions.get(id)?.outputBuffer;
  }

  clearBuffer(id: string): void {
    const session = this.sessions.get(id);
    if (session) session.outputBuffer = '';
  }

  writeToSession(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    this.ptyManager.write(session.pty, data);
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    if (session.status === 'exited') return;
    this.ptyManager.resize(session.pty, cols, rows);
    session.stateDetector.resize(cols, rows);
  }

  async restoreSessions(): Promise<void> {
    const persisted = await this.store.load();

    for (const p of persisted) {
      try {
        await access(p.folderPath);
      } catch {
        console.warn(`Skipping session "${p.name}": folder not accessible (${p.folderPath})`);
        continue;
      }
      try {
        await this.createSession(p.folderPath, p.name, p.agentType, p.flags || [], p.id, p.createdAt, p.worktreeBranch);
        console.log(`Restored session: ${p.name} (${p.folderPath}) [${p.agentType}]`);
      } catch (err) {
        console.error(`Failed to restore session "${p.name}":`, err);
      }
    }

    // Ensure sessions.json reflects only successfully restored sessions.
    // This is idempotent when all sessions restore, but necessary when some
    // or all fail — otherwise stale entries persist and retry every restart.
    await this.persistSessions();
  }

  private toSessionInfo(session: ManagedSession): SessionInfo {
    return {
      id: session.id,
      name: session.name,
      folderPath: session.folderPath,
      status: session.status,
      createdAt: session.createdAt,
      agentType: session.agentType,
      flags: session.flags,
      hasGitChanges: this.gitDirtyMap.get(session.id) ?? false,
      worktreePath: session.worktreePath,
      worktreeBranch: session.worktreeBranch,
      lastPrompt: session.lastPrompt,
    };
  }

  async shutdown(): Promise<void> {
    if (this.gitPollTimer) {
      clearInterval(this.gitPollTimer);
      this.gitPollTimer = null;
    }
    for (const session of this.sessions.values()) {
      try {
        session.stateDetector.destroy();
        this.ptyManager.kill(session.pty);
      } catch {
        // pty may already be dead — continue to next session
      }
    }
    await this.persistSessions();
  }

  private async persistSessions(): Promise<void> {
    const data: PersistedSession[] = Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      name: s.name,
      folderPath: s.folderPath,
      createdAt: s.createdAt,
      agentType: s.agentType,
      flags: s.flags,
      worktreePath: s.worktreePath,
      worktreeBranch: s.worktreeBranch,
    }));
    await this.store.save(data);
  }
}
