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
import { PtyManager, tmuxSessionName } from './PtyManager.js';
import { StateDetector } from './StateDetector.js';
import { SessionStore, type PersistedSession } from '../persistence/SessionStore.js';
import { ConfigStore } from '../persistence/ConfigStore.js';
import { AgentRegistry } from './AgentRegistry.js';
import { CompanionTerminalManager } from './CompanionTerminalManager.js';
import { cleanupSessionDimensions } from '../socket/handler.js';
import { resolveWithinBase } from '../utils/pathScope.js';
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
  /** tmux session name backing this agent (undefined in non-persistent mode). */
  tmuxName?: string;
  /** True when the agent runs inside tmux and survives an app quit. */
  persistent: boolean;
  /**
   * Set on tmux reattach: the repaint burst can read as running→idle, which
   * would falsely promote every restored session to 'done'. Swallows exactly
   * the first settle after attach, then clears.
   */
  suppressDonePromotion?: boolean;
  /** Pending timer that will promote this session to 'done' after a 2 s grace period. */
  doneTimer?: ReturnType<typeof setTimeout>;
}

const GIT_POLL_INTERVAL_MS = 10_000;

// Lines of tmux scrollback to seed into a client's xterm on (re)join, so mobile
// (and desktop after Cmd+R) can scroll up into history that predates the join.
// Fits under xterm's 5000 scrollback cap; bounded by tmux history-limit 50000.
const REPLAY_HISTORY_LINES = 2000;

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private ptyManager: PtyManager;
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
    this.ptyManager = new PtyManager(dataDir);
  }

  /** True when sessions run inside tmux and survive an app quit. */
  isPersistent(): boolean {
    return this.ptyManager.isTmuxAvailable();
  }

  setIo(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
    this.io = io;
  }

  setGitService(gitService: GitService): void {
    this.gitService = gitService;
    // Clear any prior timer so a second call doesn't orphan the first interval.
    if (this.gitPollTimer) clearInterval(this.gitPollTimer);
    this.gitPollTimer = setInterval(() => this.pollGitStatus(), GIT_POLL_INTERVAL_MS);
  }

  /**
   * Resolve `rawPath` if it falls within some managed session's working directory.
   * Returns the normalized path, or null. Read/search routes use this to scope
   * filesystem access to folders Argus actually manages — without it those routes
   * would read arbitrary files anywhere on disk.
   */
  resolveWithinAnySession(rawPath: string): string | null {
    for (const session of this.sessions.values()) {
      const resolved = resolveWithinBase(session.folderPath, rawPath);
      if (resolved) return resolved;
    }
    return null;
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

  async createSession(folderPath: string, name?: string, agentType?: string, flags?: string[], existingId?: string, existingCreatedAt?: string, worktreeBranch?: string, worktreeBase?: string, attachExisting: boolean = false): Promise<SessionInfo> {
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

    const stateDetector = new StateDetector((status) => this.applyDetectedStatus(id, status), resolvedAgentType);
    stateDetector.setOnPromptUpdate((text) => this.applyPromptUpdate(id, text));

    const resolvedFlags = flags || [];

    // tmux-backed when available (survives app quit); otherwise a plain pty.
    const persistent = this.ptyManager.isTmuxAvailable();
    const tmuxName = persistent ? tmuxSessionName(id) : undefined;
    const ptyProcess = persistent && tmuxName
      ? this.ptyManager.spawnTmux(tmuxName, effectiveFolderPath, command, 120, 30, resolvedFlags)
      : this.ptyManager.spawn(effectiveFolderPath, command, 120, 30, resolvedFlags);

    // Re-attaching to a live survivor: start neutral and let the detector
    // reclassify from the repaint, and suppress the redraw activity burst.
    if (attachExisting) stateDetector.markAttachRedraw();
    const initialStatus: SessionStatus = attachExisting ? 'idle' : 'running';

    const session: ManagedSession = {
      id,
      name: sessionName,
      folderPath: effectiveFolderPath,
      agentType: resolvedAgentType,
      flags: resolvedFlags,
      status: initialStatus,
      createdAt,
      pty: ptyProcess,
      stateDetector,
      outputBuffer: '',
      worktreePath,
      worktreeBranch,
      tmuxName,
      persistent,
      suppressDonePromotion: attachExisting,
    };

    ptyProcess.onData((data) => {
      // Ignore late output from a pty that restart already replaced (node-pty
      // flushes buffered bytes on kill, so this can fire after the swap).
      if (session.pty !== ptyProcess) return;
      // Buffer output for replay on reconnect
      session.outputBuffer += data;
      if (session.outputBuffer.length > 100_000) {
        session.outputBuffer = session.outputBuffer.slice(-100_000);
      }
      stateDetector.feed(data);
      this.io?.to(id).emit('session:output', { sessionId: id, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      // A replaced pty's exit must not be reported as the session exiting.
      if (session.pty !== ptyProcess) return;
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
    if (session.doneTimer) { clearTimeout(session.doneTimer); session.doneTimer = undefined; }
    this.ptyManager.kill(session.pty);                       // detaches the tmux client
    if (session.tmuxName) this.ptyManager.killTmuxSession(session.tmuxName); // actually stop the agent
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

    // Tear down old pty and companion terminal. Kill the tmux session too so the
    // surviving conversation is discarded — otherwise new-session -A would just
    // reattach to the old process and "restart" would be a no-op.
    session.stateDetector.destroy();
    if (session.doneTimer) { clearTimeout(session.doneTimer); session.doneTimer = undefined; }
    this.ptyManager.kill(session.pty);
    if (session.tmuxName) this.ptyManager.killTmuxSession(session.tmuxName);
    this.companionTerminals.kill(id);

    // Reset state
    session.outputBuffer = '';
    session.status = 'running';
    session.suppressDonePromotion = false; // fresh run must promote to 'done' normally

    // Resolve agent command
    const config = await this.configStore.load();
    const agentDef = this.agentRegistry.getById(session.agentType, config.customAgents);
    const command = agentDef?.command ?? session.agentType;

    // New state detector wired to same id
    const stateDetector = new StateDetector((status) => this.applyDetectedStatus(id, status), session.agentType);
    stateDetector.setOnPromptUpdate((text) => this.applyPromptUpdate(id, text));

    // Spawn fresh pty with the same flags as the original session
    const ptyProcess = session.persistent && session.tmuxName
      ? this.ptyManager.spawnTmux(session.tmuxName, session.folderPath, command, 120, 30, session.flags)
      : this.ptyManager.spawn(session.folderPath, command, 120, 30, session.flags);

    // Swap in the new pty + detector BEFORE wiring handlers. The identity guard
    // below compares against session.pty, so this ordering both (a) admits the new
    // pty's first bytes and (b) makes the OLD pty's trailing onData/onExit — fired
    // async by kill() above — no-ops, instead of emitting a spurious session:exit.
    session.pty = ptyProcess;
    session.stateDetector = stateDetector;

    ptyProcess.onData((data) => {
      if (session.pty !== ptyProcess) return;
      session.outputBuffer += data;
      if (session.outputBuffer.length > 100_000) {
        session.outputBuffer = session.outputBuffer.slice(-100_000);
      }
      stateDetector.feed(data);
      this.io?.to(id).emit('session:output', { sessionId: id, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (session.pty !== ptyProcess) return;
      stateDetector.setExited();
      this.io?.to(id).emit('session:exit', { sessionId: id, exitCode });
    });

    this.io?.emit('session:status', { sessionId: id, status: 'running' });
    return this.toSessionInfo(session);
  }

  /**
   * Apply a status reported by a session's StateDetector. Promotes a settle to
   * 'done' (finished run, unacknowledged) when the session was 'running' —
   * never for reattached sessions' first settle (repaint burst, see
   * suppressDonePromotion). Broadcast is global so dashboards on every client
   * (desktop + mobile) stay in sync, not just sockets joined to the room.
   */
  private applyDetectedStatus(id: string, detected: SessionStatus): void {
    const session = this.sessions.get(id);
    if (!session) return;

    let status = detected;
    if (detected === 'idle' || detected === 'waiting') {
      if (!session.suppressDonePromotion && detected === 'idle' && session.status === 'running') {
        status = 'done';
      }
    }

    // New activity arrived — cancel any pending done promotion.
    if (session.doneTimer && status !== 'done') {
      clearTimeout(session.doneTimer);
      session.doneTimer = undefined;
    }

    if (status === 'done') {
      if (session.doneTimer) return; // timer already running, don't restart
      // Hold 'done' promotion for 2 s: Claude pauses between tool calls and the
      // screen can look idle mid-run, causing a false done + premature notification.
      session.doneTimer = setTimeout(() => {
        session.doneTimer = undefined;
        if (!this.sessions.has(id)) return;
        session.status = 'done';
        session.lastPrompt = undefined;
        this.io?.emit('session:status', { sessionId: id, status: 'done', lastPrompt: undefined });
      }, 2_000);
      return;
    }

    session.status = status;
    if (status === 'waiting') {
      session.lastPrompt = session.stateDetector.getLastPromptText();
    } else {
      session.lastPrompt = undefined;
    }
    this.io?.emit('session:status', { sessionId: id, status, lastPrompt: session.lastPrompt });
  }

  /**
   * A repaint while already 'waiting' revealed (or changed) the agent's
   * question — the one-shot extraction at the waiting transition can miss it
   * when status flipped before the menu was painted (e.g. cursor-style hint).
   * Re-emit the unchanged status with the fresher prompt so notifications can
   * upgrade their fallback body.
   */
  private applyPromptUpdate(id: string, text: string): void {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'waiting') return;
    if (session.lastPrompt === text) return;
    session.lastPrompt = text;
    this.io?.emit('session:status', { sessionId: id, status: session.status, lastPrompt: text });
  }

  /** Client opened/focused the session: clear the unacknowledged-done flag. */
  acknowledgeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'done') return;
    session.status = 'idle';
    this.io?.emit('session:status', { sessionId: id, status: 'idle' });
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

  /**
   * A clean frame to paint on (re)join. For a live tmux-backed session, snapshot
   * the current screen — always a valid escape stream — instead of the raw
   * rolling buffer, whose 100KB slice can start mid-escape and render garbled in
   * a fresh xterm (the bug behind "__"/black-icon after Cmd+R or tray reopen).
   * Falls back to the raw buffer for non-tmux sessions or if capture fails.
   */
  getReplaySnapshot(id: string): string | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.persistent && session.tmuxName) {
      try {
        if (!this.ptyManager.isTmuxPaneDead(session.tmuxName)) {
          // Seed scrollback from history on the normal screen so the client can
          // scroll up into pre-join output. Skip for alt-screen apps (vim/less):
          // they have no meaningful scrollback and mobile routes their scroll to
          // forwarded wheel reports, not local xterm scrollback.
          const depth = this.ptyManager.isAlternateScreen(session.tmuxName) ? 0 : REPLAY_HISTORY_LINES;
          const snap = this.ptyManager.capturePane(session.tmuxName, depth).replace(/\n+$/, '');
          // capture-pane separates rows with bare LF; xterm needs CRLF or it
          // staircases. Clear+home first so the frame replaces prior content
          // (\x1b[3J erases stale scrollback, so reconnect replaces, not dupes).
          return '\x1b[2J\x1b[3J\x1b[H' + snap.replace(/\r?\n/g, '\r\n');
        }
      } catch {
        /* tmux gone / pane dead — fall through to the raw buffer */
      }
    }
    return session.outputBuffer;
  }

  clearBuffer(id: string): void {
    const session = this.sessions.get(id);
    if (session) session.outputBuffer = '';
  }

  writeToSession(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    session.suppressDonePromotion = false;
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

    // Scan for survivors once: tmux sessions still alive from a previous run.
    const tmuxAvailable = this.ptyManager.isTmuxAvailable();
    const survivors = tmuxAvailable ? this.ptyManager.listArgusSessions() : new Set<string>();
    const knownNames = new Set<string>();

    for (const p of persisted) {
      const tmuxName = tmuxSessionName(p.id);
      knownNames.add(tmuxName);

      try {
        await access(p.folderPath);
      } catch {
        console.warn(`Skipping session "${p.name}": folder not accessible (${p.folderPath})`);
        continue;
      }

      // Decide whether a live agent survived to re-attach to.
      let attach = false;
      if (survivors.has(tmuxName)) {
        if (this.ptyManager.isTmuxPaneDead(tmuxName)) {
          // Agent exited while detached — discard the dead session and start fresh.
          this.ptyManager.killTmuxSession(tmuxName);
        } else {
          attach = true;
        }
      }

      try {
        await this.createSession(p.folderPath, p.name, p.agentType, p.flags || [], p.id, p.createdAt, p.worktreeBranch, undefined, attach);
        console.log(`${attach ? 'Reattached' : 'Restored'} session: ${p.name} (${p.folderPath}) [${p.agentType}]`);
      } catch (err) {
        console.error(`Failed to restore session "${p.name}":`, err);
      }
    }

    // Reap orphan argus-* tmux sessions with no matching persisted record
    // (e.g. sessions.json was deleted, or a crash left them behind).
    if (tmuxAvailable) {
      for (const name of survivors) {
        if (!knownNames.has(name)) this.ptyManager.killTmuxSession(name);
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

  /**
   * App-quit teardown: DETACH only. Killing the tmux client (pty) detaches
   * without stopping the agent, so tmux-backed sessions keep running in the
   * background and reattach on next launch. Never kills tmux sessions here.
   */
  async shutdown(): Promise<void> {
    if (this.gitPollTimer) {
      clearInterval(this.gitPollTimer);
      this.gitPollTimer = null;
    }
    for (const session of this.sessions.values()) {
      try {
        session.stateDetector.destroy();
        this.ptyManager.kill(session.pty); // detaches tmux client; agent survives
      } catch {
        // pty may already be dead — continue to next session
      }
    }
    await this.persistSessions();
  }

  /**
   * "Quit & Stop All Sessions": actually terminate every agent (not just detach),
   * then run the normal shutdown. Kills the whole argus tmux server to be sure.
   */
  async stopAllAndShutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.tmuxName) this.ptyManager.killTmuxSession(session.tmuxName);
    }
    if (this.ptyManager.isTmuxAvailable()) this.ptyManager.killTmuxServer();
    await this.shutdown();
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
