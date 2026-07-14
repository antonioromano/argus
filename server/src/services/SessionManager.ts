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
import { SleepPreventionService } from './SleepPreventionService.js';
import { FileWatcherService } from './FileWatcherService.js';
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
  /** Last terminal dimensions reported by a client; used to size a restart's fresh
   *  pty to the viewer's grid instead of the 120×30 spawn default (avoids garble). */
  cols?: number;
  rows?: number;
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
  /**
   * True when the user has sent input (or created/restarted the session) since it
   * was last idle. Gates done-promotion: prevents internal terminal refreshes from
   * producing a spurious idle→running→done cycle.
   */
  hasUserInputSinceIdle: boolean;
}

const GIT_POLL_INTERVAL_MS = 10_000;
// Re-validate a folder's git-repo-ness this often, so a `git init` after startup
// is eventually picked up without re-spawning `git rev-parse` every tick.
const GIT_REPO_RECHECK_MS = 60_000;

// Lines of tmux scrollback to seed into a client's xterm on (re)join, so mobile
// (and desktop after Cmd+R) can scroll up into history that predates the join.
// Fits under xterm's 5000 scrollback cap; bounded by tmux history-limit 50000.
const REPLAY_HISTORY_LINES = 5000;

// A reconnect storm (tray reopen + mobile + desktop all rejoining at once) can
// trigger N tmux capture-panes for the same session within a few ms. Serve a
// short-lived cached snapshot instead so only the first join in the burst pays
// the blocking capture cost.
const REPLAY_SNAPSHOT_TTL_MS = 250;

/**
 * A standalone mouse-WHEEL report forwarded by the client's terminal (SGR
 * buttons 64/65 or the legacy 0x60/0x61 encodings). The client only ever emits
 * these for scroll — regular typing and clicks (button 0) never produce them —
 * so matching them is safe. Used to route scroll to send-keys -l (see
 * writeToSession). One session:input carries one report; allow a run of them.
 */
const WHEEL_REPORT_RE = /^(?:\x1b\[<6[4-7];\d+;\d+[Mm]|\x1b\[M[\x60-\x63]..)+$/;
function isWheelReport(data: string): boolean {
  return WHEEL_REPORT_RE.test(data);
}

/** Authoritative replay frame + the buffer/mouse truth the client reconciles to.
 *  Wire shape adds `sessionId` (see SessionReplay in @argus/shared). */
export interface SessionReplayFrame {
  data: string;
  alternate: boolean;
  appMouse: boolean;
  sgr: boolean;
}

export class SessionManager {
  private sessions = new Map<string, ManagedSession>();
  private replaySnapshotCache = new Map<string, { frame: SessionReplayFrame; capturedAt: number }>();
  private persistQueue: Promise<void> = Promise.resolve();
  private ptyManager: PtyManager;
  private agentRegistry = new AgentRegistry();
  readonly companionTerminals = new CompanionTerminalManager();
  private store: SessionStore;
  private configStore: ConfigStore;
  private io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
  private gitService: GitService | null = null;
  private gitDirtyMap = new Map<string, boolean>();
  private gitRepoCache = new Map<string, { isRepo: boolean; checkedAt: number }>();
  private gitPollRunning = false;
  private gitPollTimer: ReturnType<typeof setInterval> | null = null;
  private sleepPrevention = new SleepPreventionService();
  // Per-session folder watcher; pushes changed dirs to the session's room so
  // the client's file tree updates live (incl. externally-created files).
  private fileWatcher = new FileWatcherService((sessionId, dirs) => {
    this.io?.to(sessionId).emit('session:fsChanged', { sessionId, dirs });
  });
  private preventSleepWhileRunning = false;

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

  /** Toggle the "keep macOS awake while a shell is running" feature; reconciles immediately. */
  setPreventSleepWhileRunning(enabled: boolean): void {
    this.preventSleepWhileRunning = enabled;
    this.refreshSleepPrevention();
  }

  /**
   * Start/stop the sleep blocker to match desired state: blocked iff the feature
   * is enabled AND ≥1 session is 'running'. start()/stop() are idempotent (guarded
   * by `active`), so this is safe to call after any status mutation.
   */
  private refreshSleepPrevention(): void {
    let running = 0;
    for (const s of this.sessions.values()) if (s.status === 'running') running++;
    const want = this.preventSleepWhileRunning && running > 0;
    (want ? this.sleepPrevention.start() : this.sleepPrevention.stop()).catch(console.error);
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

  /**
   * Like resolveWithinAnySession, but also returns the owning session — symbol
   * search needs the session's folderPath as the scope root to scan the whole
   * workspace, not just the file's directory.
   */
  sessionForPath(rawPath: string): { session: ManagedSession; resolved: string } | null {
    for (const session of this.sessions.values()) {
      const resolved = resolveWithinBase(session.folderPath, rawPath);
      if (resolved) return { session, resolved };
    }
    return null;
  }

  private async pollGitStatus(): Promise<void> {
    // Skip if a previous sweep is still running, so a slow tick can't overlap the
    // next interval and pile up git subprocesses.
    if (!this.gitService || this.gitPollRunning) return;
    this.gitPollRunning = true;
    try {
      const now = Date.now();
      for (const session of this.sessions.values()) {
        if (session.status === 'exited') continue;

        // Cache git-repo-ness per folder: known non-git folders are skipped
        // entirely (no wasted `git status` spawn each tick), and the result is
        // re-validated periodically so a later `git init` is still detected.
        const cached = this.gitRepoCache.get(session.folderPath);
        const stale = !cached || now - cached.checkedAt >= GIT_REPO_RECHECK_MS;
        if (cached && !cached.isRepo && !stale) continue;
        let isRepo = cached?.isRepo ?? true;
        if (stale) {
          isRepo = await this.gitService.isGitRepo(session.folderPath);
          this.gitRepoCache.set(session.folderPath, { isRepo, checkedAt: now });
        }
        if (!isRepo) continue;

        try {
          const dirty = await this.gitService.hasChanges(session.folderPath);
          const prev = this.gitDirtyMap.get(session.id);
          if (dirty !== prev) {
            this.gitDirtyMap.set(session.id, dirty);
            this.io?.emit('session:gitStatus', { sessionId: session.id, hasGitChanges: dirty });
          }
        } catch {
          // transient git error — ignore this tick
        }
      }
    } finally {
      this.gitPollRunning = false;
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

    // Reject any agentType that doesn't resolve to a registered agent — otherwise
    // `command = agentDef?.command ?? resolvedAgentType` turns an arbitrary string
    // into a raw shell word (PtyManager interpolates it into `sh -l -c`).
    if (!this.agentRegistry.isRegistered(resolvedAgentType, config.customAgents)) {
      throw new Error(`Unknown agent type: "${resolvedAgentType}"`);
    }

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
    // Restored sessions (existingId set) start neutral, never synthetic 'running':
    // a 'running' baseline makes the first settle look like running→idle and get
    // promoted to a false 'done' on every app/Mac restart. Genuinely new sessions
    // (no existingId) still start 'running' so they notify 'done' when a run ends.
    const initialStatus: SessionStatus = (attachExisting || existingId != null) ? 'idle' : 'running';

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
      // New sessions are user-initiated; allow done-promotion on their first finish.
      // Restored/reattached sessions default to false until the user sends input.
      hasUserInputSinceIdle: !attachExisting && existingId == null,
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
    this.fileWatcher.watch(id, session.folderPath);
    this.refreshSleepPrevention();
    await this.persistSessions();

    const info = this.toSessionInfo(session);
    this.io?.emit('session:created', info);
    return info;
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);

    session.stateDetector.destroy();
    void this.fileWatcher.stop(id);
    if (session.doneTimer) { clearTimeout(session.doneTimer); session.doneTimer = undefined; }
    this.ptyManager.kill(session.pty);                       // detaches the tmux client
    if (session.tmuxName) this.ptyManager.killTmuxSession(session.tmuxName); // actually stop the agent
    this.companionTerminals.kill(id);
    this.sessions.delete(id);
    this.gitDirtyMap.delete(id);
    this.replaySnapshotCache.delete(id);
    const stillInUse = Array.from(this.sessions.values()).some((s) => s.folderPath === session.folderPath);
    if (!stillInUse) this.gitRepoCache.delete(session.folderPath);
    cleanupSessionDimensions(id);
    this.refreshSleepPrevention();
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
    this.refreshSleepPrevention();
    session.suppressDonePromotion = false; // fresh run must promote to 'done' normally
    session.hasUserInputSinceIdle = true;  // restart IS a user action

    // Resolve agent command
    const config = await this.configStore.load();
    if (!this.agentRegistry.isRegistered(session.agentType, config.customAgents)) {
      throw new Error(`Unknown agent type: "${session.agentType}"`);
    }
    const agentDef = this.agentRegistry.getById(session.agentType, config.customAgents);
    const command = agentDef?.command ?? session.agentType;

    // New state detector wired to same id
    const stateDetector = new StateDetector((status) => this.applyDetectedStatus(id, status), session.agentType);
    stateDetector.setOnPromptUpdate((text) => this.applyPromptUpdate(id, text));

    // Spawn fresh pty at the viewer's last-known grid (not the 120×30 default):
    // the client xterm isn't remounted on restart, so it keeps its current width.
    // Spawning at a mismatched size makes the fresh agent draw into the wrong grid
    // (wrapped/overlapping text). Fall back to 120×30 if no client ever reported.
    const cols = session.cols ?? 120;
    const rows = session.rows ?? 30;
    const ptyProcess = session.persistent && session.tmuxName
      ? this.ptyManager.spawnTmux(session.tmuxName, session.folderPath, command, cols, rows, session.flags)
      : this.ptyManager.spawn(session.folderPath, command, cols, rows, session.flags);

    // Wipe the client xterm before the fresh agent paints: the terminal still holds
    // the pre-restart buffer (stale scrollback rows that the new agent's startup
    // clear doesn't fully overwrite). \x1b[3J also drops scrollback so nothing lingers.
    this.io?.to(id).emit('session:output', { sessionId: id, data: '\x1b[2J\x1b[3J\x1b[H' });

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
      if (!session.suppressDonePromotion && detected === 'idle' && session.status === 'running' && session.hasUserInputSinceIdle) {
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
        if (session.status !== 'running') return; // discard: status changed before timer fired
        session.status = 'done';
        session.lastPrompt = undefined;
        this.refreshSleepPrevention();
        this.io?.emit('session:status', { sessionId: id, status: 'done', lastPrompt: undefined });
      }, 2_000);
      return;
    }

    // 'done' is sticky until acknowledgeSession or user input (writeToSession); StateDetector cannot clear it.
    if (session.status === 'done') return;

    session.status = status;
    this.refreshSleepPrevention();
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

  /** Client manually promotes an idle session to done. */
  markSessionDone(id: string): void {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'idle') return;
    session.status = 'done';
    this.io?.emit('session:status', { sessionId: id, status: 'done', lastPrompt: session.lastPrompt });
    this.persistSessions().catch(console.error);
  }

  /** Client opened/focused the session: clear the unacknowledged-done flag. */
  acknowledgeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    // Cancel any pending promotion even if not yet 'done' (timer may still be running).
    if (session.doneTimer) {
      clearTimeout(session.doneTimer);
      session.doneTimer = undefined;
    }
    if (session.status !== 'done') return;
    session.status = 'idle';
    session.hasUserInputSinceIdle = false; // user must send input before next done-promotion
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
  getReplaySnapshot(id: string): SessionReplayFrame | undefined {
    const cached = this.replaySnapshotCache.get(id);
    if (cached && Date.now() - cached.capturedAt < REPLAY_SNAPSHOT_TTL_MS) {
      return cached.frame;
    }
    const frame = this.captureReplaySnapshot(id);
    if (frame) this.replaySnapshotCache.set(id, { frame, capturedAt: Date.now() });
    else this.replaySnapshotCache.delete(id);
    return frame;
  }

  private captureReplaySnapshot(id: string): SessionReplayFrame | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.persistent && session.tmuxName) {
      try {
        if (!this.ptyManager.isTmuxPaneDead(session.tmuxName)) {
          // A resync can fire while the user has scrolled into tmux copy-mode;
          // capturing then would snapshot the scrolled view. Cancel first so the
          // capture lands on the live bottom-of-screen frame.
          this.ptyManager.exitCopyMode(session.tmuxName);
          // Seed scrollback from history on the normal screen so the client can
          // scroll up into pre-join output. Skip for alt-screen apps (vim/less):
          // they have no meaningful scrollback and history scroll routes through
          // tmux copy-mode, not local xterm scrollback.
          const { cursorX, cursorY, alternate, appMouse, sgr } = this.ptyManager.captureState(session.tmuxName);
          const depth = alternate ? 0 : REPLAY_HISTORY_LINES;
          // Strip ONLY the single trailing line-terminator, not the blank rows
          // below the cursor: those rows are part of the visible screen, and a
          // seeded buffer (history + screen) is bottom-anchored in xterm, so the
          // bottom `pane_height` rows must map 1:1 to tmux's live screen. A greedy
          // strip (/\n+$/) deletes the trailing blanks, shifting the screen-top up
          // off the viewport-top — then any in-place redraw (claude's input box via
          // \x1b[H) lands on history rows and overwrites them (old text bleeds over
          // the current screen). Keeping full height aligns redraws.
          const snap = this.ptyManager.capturePane(session.tmuxName, depth).replace(/\n$/, '');
          // Reconcile xterm's active buffer to tmux's truth, THEN paint. capture-pane
          // separates rows with bare LF; xterm needs CRLF or it staircases.
          //  - normal: `?1049l` forces xterm onto the normal buffer regardless of
          //    where it was; `\x1b[3J` erases stale scrollback so reconnect replaces
          //    rather than duplicates.
          //  - alt: `?1049l` then `?1049h` makes the buffer switch deterministic and
          //    lands on a fresh alt buffer. DROP `3J` here — clearing scrollback on
          //    the alt screen is pointless and would wipe normal-buffer history.
          // Trailing cursor-position escape restores the real cursor cell (tmux's
          // 0-based coords → xterm's 1-based; viewport-relative == screen coords
          // once the screen sits at full height in the bottom rows).
          const prefix = alternate ? '\x1b[?1049l\x1b[?1049h\x1b[2J\x1b[H' : '\x1b[?1049l\x1b[2J\x1b[3J\x1b[H';
          const data = prefix
            + snap.replace(/\r?\n/g, '\r\n')
            + `\x1b[${cursorY + 1};${cursorX + 1}H`;
          return { data, alternate, appMouse, sgr };
        }
      } catch {
        /* tmux gone / pane dead — fall through to the raw buffer */
      }
    }
    // Non-tmux / dead-pane fallback: raw rolling buffer, normal screen, gate off.
    const data = session.outputBuffer;
    if (data === undefined) return undefined;
    return { data, alternate: false, appMouse: false, sgr: true };
  }

  clearBuffer(id: string): void {
    const session = this.sessions.get(id);
    if (session) session.outputBuffer = '';
  }

  writeToSession(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    if (session.status === 'exited') return;

    // A forwarded wheel report is a scroll gesture, not user input. tmux 3.6b
    // won't dispatch mouse reports injected as client input (the WheelUpPane
    // binding never fires), so route it straight to the pane via send-keys -l —
    // where the app actually receives it and scrolls. Returning early also keeps
    // scrolling from tripping hasUserInputSinceIdle / clearing a 'done' badge.
    if (isWheelReport(data)) {
      if (session.tmuxName) {
        try { this.ptyManager.sendKeysLiteral(session.tmuxName, data); } catch { /* session may be gone */ }
      }
      return;
    }

    session.suppressDonePromotion = false;
    session.hasUserInputSinceIdle = true;
    // User sent input — exit sticky-done so StateDetector can track the new run.
    if (session.status === 'done') {
      session.status = 'idle';
      this.io?.emit('session:status', { sessionId: id, status: 'idle' });
    }
    this.ptyManager.write(session.pty, data);
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    if (session.status === 'exited') return;
    this.ptyManager.resize(session.pty, cols, rows);
    session.stateDetector.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
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
    await this.fileWatcher.stopAll();
    await this.sleepPrevention.stop();
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

  // Queued so concurrent create/destroy calls can't race two store.save()
  // writes and let a stale snapshot win. Each queued job reads `this.sessions`
  // only once it's its turn, so it always persists the latest state.
  private persistSessions(): Promise<void> {
    const run = this.persistQueue.then(async () => {
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
    });
    this.persistQueue = run.catch(() => {});
    return run;
  }
}
