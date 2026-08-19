import { v4 as uuidv4 } from 'uuid';
import { access, mkdir } from 'fs/promises';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import os from 'os';
import type { IPty } from 'node-pty';
import type { Server } from 'socket.io';
import type {
  SessionInfo,
  SessionStatus,
  AgentSignalState,
  AgentSignal,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@argus/shared';
import { SESSION_NAME_MAX } from '../constants/session.js';
import { PtyManager, tmuxSessionName } from './PtyManager.js';
import { StateDetector } from './StateDetector.js';
import { TerminalMirror } from './TerminalMirror.js';
import { coverageFor } from './agentSignals/coverage.js';
import { computeSignalToken } from './agentSignals/token.js';
import { getSignalAdapter } from './agentSignals/registry.js';
import type { InjectionFile } from './agentSignals/types.js';
import { makePtyBackend } from './ptyBackend/index.js';
import type { PtyBackend } from './ptyBackend/types.js';
import { buildReport, writeReport, type SessionDiagnosticsPayload } from './SessionDiagnostics.js';
import { SessionStore, type PersistedSession } from '../persistence/SessionStore.js';
import { ConfigStore } from '../persistence/ConfigStore.js';
import { AgentRegistry } from './AgentRegistry.js';
import { CompanionTerminalManager } from './CompanionTerminalManager.js';
import { IdleGeometryGate } from './idleGeometryGate.js';
import { SleepPreventionService } from './SleepPreventionService.js';
import { FileWatcherService } from './FileWatcherService.js';
import { findStaleRowRange } from './scrollbackDedup.js';
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
  /** Authoritative server-side screen — shared with stateDetector, source of replay frames. */
  mirror: TerminalMirror;
  outputBuffer: string;
  /** Output accumulated since the last socket flush (see emitOutput). */
  pendingOutput?: string;
  flushTimer?: NodeJS.Timeout;
  /** True while the backend is replaying this session's history after its
   *  transport came back (see beginResync): bytes feed the mirror but are
   *  withheld from clients, who get one authoritative frame at the end. */
  resyncing?: boolean;
  resyncSettleTimer?: NodeJS.Timeout;
  /** Wall-clock cap for the reseed window — a streaming session never goes quiet. */
  resyncDeadline?: number;
  worktreePath?: string;
  worktreeBranch?: string;
  lastPrompt?: string;
  /** Native-signal arbitration (plan 2026-07-22-001): when the last native
   *  signal arrived, the state it reported, and the states this session's
   *  adapter covers. While fresh, the arbiter suppresses contradicting
   *  heuristic transitions for covered states. */
  nativeLastSeenAt?: number;
  nativeState?: AgentSignalState;
  nativeCoverage?: Set<AgentSignalState>;
  /** Last few raw native signals — diagnostics dump only, never control flow. */
  nativeRing?: AgentSignal[];
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
  /** Pending quiet-check for the post-width-change scrollback trim (see TRIM_QUIET_MS). */
  trimTimer?: ReturnType<typeof setTimeout>;
  /** When the re-arming quiet-check gives up and trims anyway (TRIM_MAX_WAIT_MS). */
  trimDeadline?: number;
  /** In-flight trim; a second one chains onto it rather than racing its broadcast. */
  trimPromise?: Promise<void>;
  /**
   * Row count the mirror held when the width last changed — the line between
   * pre-resize history and whatever the agent reprints in response. Recorded
   * *after* the resize, since narrowing reflows the buffer and moves every index.
   */
  trimBoundary?: number;
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

// Rolling output buffer cap (see onData slicing); surfaced in diagnostics so a
// dump shows fill-vs-cap. Keep in sync with the slice length in onData.
const OUTPUT_BUFFER_CAP = 100_000;
// How much of the rolling buffer to embed as the raw-tail fallback in a dump.
const RAW_TAIL_BYTES = 16 * 1024;

// A native signal keeps its authority for this long. Refreshed by every native
// event; once stale (old CLI, user stripped the hook config), the heuristic
// detector silently takes back over (plan 2026-07-22-001, R4).
const NATIVE_FRESHNESS_MS = 30_000;
/** Hold 'done' promotion until the screen stops painting for this long. */
const DONE_GRACE_MS = 2_000;
/** Output younger than this at grace-fire means the session is still working. */
const DONE_QUIET_MS = 1_200;
// Depth of the per-session raw-signal ring kept for the diagnostics dump.
const NATIVE_RING_SIZE = 5;

/**
 * Claude's `Notification` hook is wired to `waiting` for BOTH a genuine
 * permission prompt AND the ~60s "Claude is waiting for your input" idle nudge —
 * a hook command can't branch on the message, so both post the same state. The
 * nudge is NOT a pending decision: it fires only because the user hasn't typed
 * since the turn finished, so it must not resurrect a done/idle session into a
 * bogus `waiting` (a genuine permission prompt fires mid-run and carries a
 * different message). This matches the nudge message; tolerant of minor wording
 * drift across Claude versions.
 */
const CLAUDE_IDLE_NUDGE_RE = /waiting for (your |the )?input/i;
function isClaudeIdleNudge(agentType: string, promptText: string | undefined): boolean {
  return agentType === 'claude' && !!promptText && CLAUDE_IDLE_NUDGE_RE.test(promptText);
}

/**
 * Coalesce pty output into ≤60fps socket emissions. Per-chunk emits (node-pty
 * fires one per read) produce hundreds of messages/sec under streaming; each
 * becomes an xterm write task in the renderer, and the back-to-back task
 * stream starves React commits — a file-tree expand took 700ms–∞ to paint
 * while any terminal streamed (measured via DevTools; no single long task,
 * just no idle gap). One frame of added echo latency is imperceptible.
 */
const OUTPUT_COALESCE_MS = 16;
/** Flush early if a burst accumulates this much before the timer fires. */
const OUTPUT_COALESCE_MAX_BYTES = 64 * 1024;

/**
 * Row floor for a session no client is watching (last viewer minimized its tile
 * or closed the window). Argus otherwise leaves the pty frozen at the geometry
 * of whatever tile it last lived in — a mosaic tile is 12–25 rows — and the
 * agent keeps streaming into that short screen. Ink (Claude Code's renderer)
 * repaints its live region by erasing the rows it believes it wrote; once a
 * frame is taller than the screen the overflow has already scrolled off, the
 * erase misses it, and the repaint lands *below* the leftovers. One duplicated
 * block per overflowing frame, all baked into the mirror and still there when
 * the tile comes back. Nobody is looking at an unattached session, so a taller
 * screen is free. Rows only — raising cols would rewrap the transcript, which
 * is the *other* half of that bug.
 */
export const IDLE_MIN_ROWS = 40;

/**
 * Grid a session is spawned with, before any client reports its tile size. Also
 * the assumed geometry when a session was never attached (nothing resized it).
 */
export const SPAWN_COLS = 120;
export const SPAWN_ROWS = 30;

/**
 * How long a session must stay unattached before it gets the idle row floor.
 * Long enough to cover a socket.io reconnect (500ms–3s backoff) and an app
 * window closing and reopening, so ordinary churn never reaches the pty.
 */
export const IDLE_GEOMETRY_DELAY_MS = 15_000;

/**
 * How long the pty must stay quiet after a width change before the stale
 * scrollback is dropped. The trim can't happen at resize time: the rows we want
 * gone don't exist yet. They appear *during* the agent's SIGWINCH repaint — it
 * reprints its transcript at the new width, and the old copy scrolls up into
 * history as it does. So wait for that repaint to finish.
 */
export const TRIM_QUIET_MS = 600;
/** A session that never goes quiet (long stream) still gets trimmed eventually. */
export const TRIM_MAX_WAIT_MS = 15_000;

/**
 * How much text must match before a block counts as the agent's reprint. Guards
 * against coincidental repetition (a repeated prompt line, a banner) costing the
 * user real scrollback. Tuned against live sessions — raise it if legitimate
 * history ever disappears, lower it if short duplicates survive.
 */
export const MIN_DEDUP_CHARS = 200;

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

/**
 * How much of the mirror a replay frame carries.
 *
 * `full` — screen + scrollback, opened with ED 3. The only correct frame for a
 * client whose buffer is empty or stale (mount, socket reconnect, daemon
 * re-attach, post-trim refresh): it must replace whatever is there.
 *
 * `screen` — the visible screen alone, no ED 3. For a mid-life resync, where the
 * client already holds correct history and only its screen has drifted out of
 * alignment. Erasing its scrollback there would throw away the reader's place
 * for nothing.
 */
export type ReplayFlavor = 'full' | 'screen';

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
  /** Shared with NgrokService and KeepAwakeService — see SleepPreventionService. */
  private readonly sleepPrevention: SleepPreventionService;
  // Per-session folder watcher; pushes changed dirs to the session's room so
  // the client's file tree updates live (incl. externally-created files).
  private fileWatcher = new FileWatcherService((sessionId, dirs) => {
    this.io?.to(sessionId).emit('session:fsChanged', { sessionId, dirs });
  });
  private preventSleepWhileRunning = false;

  private readonly dataDir: string;
  /** Native-signal wiring, supplied by index.ts once resolved (plan 001 U2). */
  private signalSecret?: string;
  private signalBinPath?: string;

  /** Process-survival + pty layer (tmux by default; argusd daemon behind a flag). */
  private backend: PtyBackend;

  /** Deferred idle-geometry resizes, so a transient viewer loss costs no SIGWINCH. */
  private idleGeometry = new IdleGeometryGate(IDLE_GEOMETRY_DELAY_MS, (id) => this.applyIdleGeometry(id));

  constructor(
    dataDir: string,
    configStore: ConfigStore,
    sleepPrevention: SleepPreventionService = new SleepPreventionService(),
  ) {
    this.dataDir = dataDir;
    this.store = new SessionStore(path.join(dataDir, 'sessions.json'));
    this.configStore = configStore;
    this.sleepPrevention = sleepPrevention;
    this.ptyManager = new PtyManager(dataDir);
    this.backend = makePtyBackend(this.ptyManager, dataDir);
    this.wireBackend();
  }

  /** Subscribe to backend-level events that outlive an individual session. */
  private wireBackend(): void {
    this.backend.onSessionResync?.((id) => this.beginResync(id));
  }

  /**
   * Re-resolve the pty backend from the persisted config preference. Called once
   * at startup before restoreSessions; a no-op once sessions exist, because a
   * running session is bound to its backend (a live tmux session can't become a
   * daemon session) — changing the setting takes effect on the next app launch.
   */
  configureBackend(preference: 'auto' | 'tmux'): void {
    if (this.sessions.size > 0) return;
    this.backend = makePtyBackend(this.ptyManager, this.dataDir, preference);
    this.wireBackend();
  }

  /** Wire the native agent-signal secret + resolved argus-signal binary path. */
  setSignalConfig(secret: string, binPath: string): void {
    this.signalSecret = secret;
    this.signalBinPath = binPath;
  }

  /**
   * Compose a session's native-signal injection: the adapter's flags/env/files
   * plus the common ARGUS_SIGNAL_URL/TOKEN env. Returns null when signals are
   * unconfigured or the agent has no adapter (→ heuristic-only). Writes are done
   * by the caller right before spawn.
   */
  private buildSignalInjection(
    sessionId: string,
    agentType: string,
    userFlags: string[],
  ): { flags: string[]; env: Record<string, string>; files: InjectionFile[]; coverage: readonly AgentSignalState[] } | null {
    if (!this.signalSecret || !this.signalBinPath) return null;
    const adapter = getSignalAdapter(agentType);
    if (!adapter) return null;

    const port = process.env.ARGUS_PORT || process.env.PORT || '5401';
    const url = `http://127.0.0.1:${port}/api/agent-signals`;
    const token = computeSignalToken(this.signalSecret, sessionId);
    const signalDir = path.join(this.dataDir, 'signals');
    try {
      mkdirSync(signalDir, { recursive: true });
    } catch {
      /* dir may already exist */
    }

    const inj = adapter.inject({ sessionId, signalBinPath: this.signalBinPath, signalDir, userFlags });
    return {
      flags: inj.flags,
      env: { ...inj.env, ARGUS_SIGNAL_URL: url, ARGUS_SIGNAL_TOKEN: token },
      files: inj.files,
      coverage: adapter.coverage,
    };
  }

  /** True when sessions survive an app quit (tmux or daemon backend). */
  isPersistent(): boolean {
    return this.backend.isPersistent();
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
    (want
      ? this.sleepPrevention.acquire('sessions')
      : this.sleepPrevention.release('sessions')
    ).catch(console.error);
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

    // Authoritative screen for this session, sized to the spawn grid. Shared
    // with the detector so classification + replay read one emulator.
    const mirror = new TerminalMirror(120, 30);
    const stateDetector = new StateDetector(
      (status) => this.applyDetectedStatus(id, status),
      resolvedAgentType,
      120,
      30,
      mirror,
    );
    stateDetector.setOnPromptUpdate((text) => this.applyPromptUpdate(id, text));

    const resolvedFlags = flags || [];

    // Native-signal injection (plan 001 U2/U3): only on a FRESH create — a tmux
    // `new-session -A` re-attach ignores the command/flags/-e env, and the
    // surviving agent keeps the hooks it was spawned with (the settings file
    // persists on disk across restart, R6). A restored session's arbiter falls
    // back to coverageFor(agentType), so native signals from a survivor still count.
    const inj = attachExisting ? null : this.buildSignalInjection(id, resolvedAgentType, resolvedFlags);
    if (inj) {
      for (const f of inj.files) {
        try {
          writeFileSync(f.path, f.content);
        } catch (e) {
          console.warn(`[agentSignals] failed to write ${f.path}:`, e);
        }
      }
    }
    const spawnFlags = inj?.flags ?? resolvedFlags;
    const spawnEnv = inj?.env ?? {};

    // Survives app quit when the backend is persistent. tmuxName is set only for
    // the tmux backend (diagnostics/legacy); the daemon backend keys off id.
    const persistent = this.backend.isPersistent();
    const tmuxName = persistent && this.backend.kind === 'tmux' ? tmuxSessionName(id) : undefined;
    await this.backend.ready?.();
    const ptyProcess = this.backend.spawn({
      sessionId: id,
      folderPath: effectiveFolderPath,
      command,
      cols: SPAWN_COLS,
      rows: SPAWN_ROWS,
      flags: spawnFlags,
      extraEnv: spawnEnv,
      attachExisting,
    });

    // Re-attaching to a live survivor: start neutral and let the detector
    // reclassify from the repaint, and suppress the redraw activity burst.
    if (attachExisting) stateDetector.markAttachRedraw();

    // Survivor mirror seeding (plan 002 U3): a restored session gets a FRESH,
    // empty mirror, so without a seed its replay would carry no pre-restart
    // scrollback until new output arrives. The backend seeds it — tmux via one
    // capture-pane feed (queued ahead of the attach-repaint), daemon via the
    // ring the attach already replayed through onData.
    if (attachExisting) this.backend.seedMirror(id, mirror);
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
      mirror,
      outputBuffer: '',
      // Eager coverage for a freshly-injected session; a restored survivor leaves
      // this undefined and the arbiter falls back to coverageFor(agentType).
      nativeCoverage: inj ? new Set(inj.coverage) : undefined,
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
      // Mid-reseed these bytes are history the clients already have; they go to
      // the mirror only, and one authoritative frame follows (see beginResync).
      if (session.resyncing) {
        this.armResyncSettle(session);
        return;
      }
      this.emitOutput(session, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      // A replaced pty's exit must not be reported as the session exiting.
      if (session.pty !== ptyProcess) return;
      stateDetector.setExited();
      this.flushOutput(id);
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

  /**
   * Change a session's display name. Cosmetic only: the tmux session name is
   * derived from the session id, so nothing about the running agent changes.
   * Throws on an unknown id or a name that is empty once trimmed.
   */
  async renameSession(id: string, name: string): Promise<SessionInfo> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);

    const trimmed = name.trim().slice(0, SESSION_NAME_MAX);
    if (!trimmed) throw new Error('Session name cannot be empty');

    session.name = trimmed;
    await this.persistSessions();
    this.io?.emit('session:renamed', { sessionId: id, name: trimmed });
    return this.toSessionInfo(session);
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);

    session.stateDetector.destroy();
    session.mirror?.dispose();
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = undefined;
    }
    // Remove the generated native-signal settings file (best-effort).
    try {
      rmSync(path.join(this.dataDir, 'signals', `${id}.json`), { force: true });
    } catch {
      /* ignore */
    }
    void this.fileWatcher.stop(id);
    if (session.doneTimer) { clearTimeout(session.doneTimer); session.doneTimer = undefined; }
    if (session.trimTimer) { clearTimeout(session.trimTimer); session.trimTimer = undefined; }
    this.backend.detach(session.pty);   // detach our client (tmux) / stop receiving (daemon)
    this.backend.stopSession(id);        // actually stop the agent
    this.companionTerminals.kill(id);
    this.sessions.delete(id);
    this.gitDirtyMap.delete(id);
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
    session.mirror?.dispose(); // detector no longer owns the injected mirror; free it here
    if (session.doneTimer) { clearTimeout(session.doneTimer); session.doneTimer = undefined; }
    if (session.trimTimer) { clearTimeout(session.trimTimer); session.trimTimer = undefined; }
    this.backend.detach(session.pty);
    this.backend.stopSession(id); // discard the surviving conversation so restart is a real restart
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

    // Fresh grid: the viewer's last-known size (not the 120×30 default). The
    // client xterm isn't remounted on restart, so it keeps its current width;
    // spawning at a mismatched size makes the fresh agent draw into the wrong
    // grid (wrapped/overlapping text). Fall back to 120×30 if none reported.
    const cols = session.cols ?? 120;
    const rows = session.rows ?? 30;

    // New mirror + state detector wired to the same id, sized to the fresh grid.
    const mirror = new TerminalMirror(cols, rows);
    const stateDetector = new StateDetector(
      (status) => this.applyDetectedStatus(id, status),
      session.agentType,
      cols,
      rows,
      mirror,
    );
    stateDetector.setOnPromptUpdate((text) => this.applyPromptUpdate(id, text));

    // Restart is a fresh run (the old tmux session was killed above), so re-inject
    // native signals and reset the native-freshness window.
    const inj = this.buildSignalInjection(id, session.agentType, session.flags);
    if (inj) {
      for (const f of inj.files) {
        try {
          writeFileSync(f.path, f.content);
        } catch (e) {
          console.warn(`[agentSignals] failed to write ${f.path}:`, e);
        }
      }
    }
    session.nativeCoverage = inj ? new Set(inj.coverage) : undefined;
    session.nativeLastSeenAt = undefined;
    session.nativeState = undefined;
    const spawnFlags = inj?.flags ?? session.flags;
    const spawnEnv = inj?.env ?? {};
    await this.backend.ready?.();
    const ptyProcess = this.backend.spawn({
      sessionId: id,
      folderPath: session.folderPath,
      command,
      cols,
      rows,
      flags: spawnFlags,
      extraEnv: spawnEnv,
      attachExisting: false,
    });

    // Wipe the client xterm before the fresh agent paints: the terminal still holds
    // the pre-restart buffer (stale scrollback rows that the new agent's startup
    // clear doesn't fully overwrite). \x1b[3J also drops scrollback so nothing lingers.
    // Routed through emitOutput so it stays ordered behind the old pty's last bytes.
    this.emitOutput(session, '\x1b[2J\x1b[3J\x1b[H');

    // Swap in the new pty + detector BEFORE wiring handlers. The identity guard
    // below compares against session.pty, so this ordering both (a) admits the new
    // pty's first bytes and (b) makes the OLD pty's trailing onData/onExit — fired
    // async by kill() above — no-ops, instead of emitting a spurious session:exit.
    session.pty = ptyProcess;
    session.stateDetector = stateDetector;
    session.mirror = mirror;

    ptyProcess.onData((data) => {
      if (session.pty !== ptyProcess) return;
      session.outputBuffer += data;
      if (session.outputBuffer.length > 100_000) {
        session.outputBuffer = session.outputBuffer.slice(-100_000);
      }
      stateDetector.feed(data);
      this.emitOutput(session, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (session.pty !== ptyProcess) return;
      stateDetector.setExited();
      this.flushOutput(id);
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

    // Native-signal arbitration (plan 2026-07-22-001): while a native channel is
    // fresh, it is authoritative for the states its adapter covers — drop the
    // heuristic transition for a covered state. Heuristic still owns 'exited'
    // (never in coverage) and everything once the native window goes stale (R3/R4).
    // Exception: heuristic 'running' always applies — it is driven by real output
    // activity, which a wrong native claim cannot fake. Claude fires Stop (→idle)
    // and the 60s "waiting for your input" Notification while a background Task
    // subagent is still working (its inner tool calls emit no hooks), so a fresh
    // native idle/waiting must not pin the status while the terminal streams.
    if (detected !== 'running' && this.nativeIsFresh(session)) {
      const coverage = session.nativeCoverage ?? new Set(coverageFor(session.agentType));
      if (coverage.has(detected as AgentSignalState)) return;
    }

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
      this.armDoneGrace(session);
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

  /**
   * Arm the done-grace timer (idempotent): Claude pauses between tool calls and
   * the screen can look idle mid-run, so promotion waits DONE_GRACE_MS and then
   * re-checks via tryPromoteDone.
   */
  private armDoneGrace(session: ManagedSession): void {
    if (session.doneTimer) return; // timer already running, don't restart
    session.doneTimer = setTimeout(() => {
      session.doneTimer = undefined;
      this.tryPromoteDone(session.id);
    }, DONE_GRACE_MS);
  }

  /**
   * Promote a session to 'done' if it is genuinely finished: still 'running'
   * (nothing changed it since the grace was armed) AND the screen has stopped
   * painting. Recent output means work is still happening — e.g. a background
   * Task subagent whose inner tool calls fire no hooks — so promotion is
   * skipped; the eventual SubagentStop → re-invoke → Stop cycle lands the real
   * 'done' later.
   */
  private tryPromoteDone(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.status !== 'running') return; // discard: status changed before the grace fired
    if (session.stateDetector.msSinceLastFeed() < DONE_QUIET_MS) return;
    session.status = 'done';
    session.lastPrompt = undefined;
    this.refreshSleepPrevention();
    this.io?.emit('session:status', { sessionId: id, status: 'done', lastPrompt: undefined });
  }

  private nativeIsFresh(session: ManagedSession): boolean {
    return (
      session.nativeLastSeenAt !== undefined &&
      Date.now() - session.nativeLastSeenAt < NATIVE_FRESHNESS_MS
    );
  }

  /**
   * Ingest a native lifecycle signal (Claude/Gemini hooks, Codex notify),
   * forwarded by the agent-signals route. Records freshness so the arbiter can
   * suppress contradicting heuristics (plan 2026-07-22-001), then applies the
   * state — with two differences from the heuristic path: a native `idle` is a
   * real turn boundary, so it promotes to `done` immediately (no 2s grace); and
   * native `promptText` wins over screen scraping for the notification body (R7).
   * Unknown/exited sessions are ignored (fire-and-forget from the CLI).
   */
  applyNativeSignal(
    id: string,
    signal: { state: AgentSignalState; promptText?: string; coverage?: AgentSignalState[] },
  ): void {
    const session = this.sessions.get(id);
    if (!session || session.status === 'exited') return;

    session.nativeLastSeenAt = Date.now();
    session.nativeState = signal.state;
    if (signal.coverage && signal.coverage.length > 0) {
      session.nativeCoverage = new Set(signal.coverage);
    }
    // Diagnostics ring only — never trusted for control flow.
    const raw: AgentSignal = {
      sessionId: id,
      state: signal.state,
      promptText: signal.promptText,
      source: 'native',
    };
    (session.nativeRing ??= []).push(raw);
    if (session.nativeRing.length > NATIVE_RING_SIZE) session.nativeRing.shift();

    // A native event is a turn boundary — cancel any pending heuristic done-grace.
    if (session.doneTimer) {
      clearTimeout(session.doneTimer);
      session.doneTimer = undefined;
    }

    // Claude's 60s "waiting for your input" idle nudge arrives as a native
    // `waiting` but is only a turn boundary (see isClaudeIdleNudge). Coerce it to
    // `idle` for control flow so it can't override a finished session — and drop
    // its promptText, which is the generic nudge string, not a real question. The
    // raw `waiting` is still recorded in nativeRing above for diagnostics.
    const effectiveState: AgentSignalState = isClaudeIdleNudge(session.agentType, signal.promptText)
      ? 'idle'
      : signal.state;
    const effectivePrompt = effectiveState === signal.state ? signal.promptText : undefined;

    let status: SessionStatus = effectiveState;
    // Native idle promotes to 'done' under the same gates as the heuristic path:
    // a genuine finish of a user-initiated run. Immediate only when the screen
    // is already quiet — Claude's Stop hook also fires when the MAIN turn ends
    // while a background Task subagent keeps working (its inner tool calls emit
    // no hooks), and there the terminal is still painting. In that case hold the
    // promotion behind the grace timer, which re-checks quiescence before firing.
    if (
      effectiveState === 'idle' &&
      !session.suppressDonePromotion &&
      session.status === 'running' &&
      session.hasUserInputSinceIdle
    ) {
      if (session.stateDetector.msSinceLastFeed() < DONE_QUIET_MS) {
        this.armDoneGrace(session);
        return; // stay 'running' — a still-painting screen is not a finished session
      }
      status = 'done';
    }

    // 'done' is sticky vs a repeat idle; a native running/waiting is genuine new
    // activity and clears it.
    if (session.status === 'done' && (status === 'idle' || status === 'done')) return;

    session.status = status;
    if (status === 'waiting') {
      session.lastPrompt = effectivePrompt ?? session.stateDetector.getLastPromptText();
    } else {
      session.lastPrompt = undefined;
    }
    this.refreshSleepPrevention();
    this.io?.emit('session:status', { sessionId: id, status, lastPrompt: session.lastPrompt });
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
   * Assemble a full diagnostics snapshot for one session — Argus's in-memory
   * status machine + StateDetector signals + tmux/pty truth + the session's
   * scrollback — and write it to `~/.argus/diagnostics/`. Returns the written
   * file path, or undefined if the session doesn't exist. Read-only w.r.t. the
   * session (never mutates tmux/copy-mode state).
   */
  async collectSessionDiagnostics(id: string): Promise<string | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    let tmux: SessionDiagnosticsPayload['tmux'] = null;
    if (session.tmuxName) {
      const paneDead = this.ptyManager.isTmuxPaneDead(session.tmuxName);
      const state = this.ptyManager.captureState(session.tmuxName);
      tmux = { tmuxName: session.tmuxName, paneDead, ...state };
    }
    // Scrollback is the authoritative mirror's serialized screen (was a tmux
    // capture-pane) — consistent with what replay now serves, and non-blocking.
    let scrollback: string | null = null;
    try {
      scrollback = session.mirror.serialize();
    } catch {
      scrollback = null;
    }

    const capturedAt = new Date().toISOString();
    const payload: SessionDiagnosticsPayload = {
      session: this.toSessionInfo(session),
      runtime: {
        persistent: session.persistent,
        tmuxName: session.tmuxName,
        cols: session.cols,
        rows: session.rows,
        suppressDonePromotion: !!session.suppressDonePromotion,
        donePromotionPending: session.doneTimer != null,
        hasUserInputSinceIdle: session.hasUserInputSinceIdle,
        outputBufferBytes: session.outputBuffer.length,
        outputBufferCapBytes: OUTPUT_BUFFER_CAP,
        connectedClients: this.io?.sockets.adapter.rooms.get(id)?.size ?? 0,
        native: {
          state: session.nativeState ?? null,
          lastSeenAt: session.nativeLastSeenAt ?? null,
          ageMs: session.nativeLastSeenAt !== undefined ? Date.now() - session.nativeLastSeenAt : null,
          fresh: this.nativeIsFresh(session),
          coverage: session.nativeCoverage ? [...session.nativeCoverage] : null,
          ring: session.nativeRing ?? [],
        },
      },
      detector: session.stateDetector.getDiagnostics(),
      tmux,
      scrollback,
      rawTail: session.outputBuffer.slice(-RAW_TAIL_BYTES),
      app: {
        nodeEnv: process.env['NODE_ENV'] ?? '',
        port: process.env['ARGUS_PORT'] ?? process.env['PORT'] ?? '',
        tmuxSocket: process.env['ARGUS_TMUX_SOCKET'] ?? 'argus',
        pid: process.pid,
        capturedAt,
      },
    };

    const { markdown } = buildReport(payload);
    return writeReport(this.dataDir, markdown, payload.session, capturedAt);
  }

  /** Force StateDetector to re-classify now and re-emit status. Returns false if unknown. */
  forceDetect(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.stateDetector.forceReclassify();
    return true;
  }

  /**
   * A clean frame to paint on (re)join, served synchronously from the session's
   * `TerminalMirror` — the authoritative server-side screen fed every pty byte.
   * No tmux subprocess, no TTL cache: `serialize()` is an in-memory read, so a
   * reconnect storm is cheap and deterministic (plan 2026-07-22-002 Unit 2).
   *
   * Phase-1 keeps the client-side reconcile prefix verbatim (Q5 truth table
   * peels it in Unit 4). Unlike the old capture-pane frame — which needed a
   * different prefix for alt vs normal because it captured only one screen —
   * `serialize()` re-emits the buffer switch (`?1049h`) and both buffers itself,
   * so a single prefix that (a) forces the client onto the normal buffer and
   * (b) clears its stale screen + scrollback is correct for both cases. The
   * frame then repaints everything (validated by TerminalMirror dirty-target
   * tests). Falls back to the raw rolling buffer only if the mirror is unusable.
   */
  /** Queue output for the session's room, coalesced into ≤60fps emissions. */
  private emitOutput(session: ManagedSession, data: string): void {
    session.pendingOutput = (session.pendingOutput ?? '') + data;
    if (session.pendingOutput.length >= OUTPUT_COALESCE_MAX_BYTES) {
      this.flushOutput(session.id);
      return;
    }
    if (!session.flushTimer) {
      session.flushTimer = setTimeout(() => this.flushOutput(session.id), OUTPUT_COALESCE_MS);
    }
  }

  /**
   * Emit any coalesced output now. The join handler calls this BEFORE adding a
   * socket to the room: pending bytes are already baked into the mirror, so the
   * replay frame covers them — flushing after the join would paint them twice.
   */
  flushOutput(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = undefined;
    }
    if (session.pendingOutput) {
      const data = session.pendingOutput;
      session.pendingOutput = '';
      this.io?.to(id).emit('session:output', { sessionId: id, data });
    }
  }

  getReplaySnapshot(id: string, flavor: ReplayFlavor = 'full'): SessionReplayFrame | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    try {
      const alternate = session.mirror.bufferType() === 'alternate';
      const { appMouse, sgr } = session.mirror.modes();
      // Alt screen has no scrollback to protect, and the frame must re-emit the
      // buffer switch to land at all — so a screen-only frame buys nothing here.
      if (flavor === 'screen' && !alternate) {
        return {
          data: '\x1b[?1049l\x1b[2J\x1b[H' + session.mirror.serializeScreen(),
          alternate,
          appMouse,
          sgr,
        };
      }
      const prefix = '\x1b[?1049l\x1b[2J\x1b[3J\x1b[H';
      return { data: prefix + session.mirror.serialize(), alternate, appMouse, sgr };
    } catch {
      // Mirror unexpectedly unusable — fall back to the raw rolling buffer.
      const data = session.outputBuffer;
      if (data === undefined) return undefined;
      return { data, alternate: false, appMouse: false, sgr: true };
    }
  }

  /**
   * "Clear terminal" (Cmd+L). Drops the scrollback the *mirror* holds, not just
   * the legacy rolling buffer — the mirror is what replay serves, so clearing
   * only the client's xterm left every stale row (duplicated blocks from a pty
   * width change, overflow leftovers from a short pane) to reappear on the next
   * join or resync. Keeps the visible screen, then repaints everyone in the room
   * so a mosaic tile and a phone don't disagree about what history exists.
   */
  async clearBuffer(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    session.outputBuffer = '';
    await this.purgeScrollback(id);
  }

  /**
   * Drop the mirror's history, keep the screen, and repaint everyone watching so
   * a mosaic tile and a phone don't disagree about what history exists.
   */
  private async purgeScrollback(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    // Pending bytes belong before the clear, or they'd be dropped by it.
    this.flushOutput(id);
    await session.mirror?.clearScrollback();
    const frame = this.getReplaySnapshot(id);
    // 'refresh': unsolicited, so a client whose user is scrolled up may ignore it
    // rather than have its viewport yanked to the bottom.
    if (frame) this.io?.to(id).emit('session:replay', { sessionId: id, ...frame, reason: 'refresh' });
  }

  /** Quiet window that marks the end of a reseed burst (the daemon's ring
   *  replay arrives as one run of chunks, then normal live output resumes). */
  private static readonly RESYNC_SETTLE_MS = 250;
  /**
   * Hard cap on the reseed window. A session that is actively streaming never
   * goes quiet, so waiting for quiet alone would withhold its output forever —
   * the terminal stays blank exactly for the busy sessions that matter most.
   * Past this the frame goes out and live output resumes regardless.
   */
  private static readonly RESYNC_MAX_MS = 1_500;

  /**
   * The backend re-attached this session after its transport came back, and is
   * about to replay the session's entire history. Two things must not happen:
   * the mirror must not end up with the pre-drop screen stacked above the
   * replayed one, and clients must not receive the replay as *new* output —
   * that would paste the whole transcript a second time into their terminals.
   *
   * So: wipe the mirror, withhold client emission, and once the burst goes
   * quiet send one authoritative frame instead.
   */
  beginResync(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    // Anything buffered belongs to the pre-drop stream the replay supersedes.
    session.pendingOutput = '';
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = undefined;
    }
    session.outputBuffer = '';
    session.resyncing = true;
    session.resyncDeadline = Date.now() + SessionManager.RESYNC_MAX_MS;
    void session.mirror?.reset();
    this.armResyncSettle(session);
  }

  private armResyncSettle(session: ManagedSession): void {
    if (!session.resyncing) return;
    const remaining = (session.resyncDeadline ?? 0) - Date.now();
    if (remaining <= 0) {
      this.endResync(session);
      return;
    }
    if (session.resyncSettleTimer) clearTimeout(session.resyncSettleTimer);
    session.resyncSettleTimer = setTimeout(
      () => this.endResync(session),
      Math.min(SessionManager.RESYNC_SETTLE_MS, remaining),
    );
    session.resyncSettleTimer.unref?.();
  }

  private endResync(session: ManagedSession): void {
    if (session.resyncSettleTimer) {
      clearTimeout(session.resyncSettleTimer);
      session.resyncSettleTimer = undefined;
    }
    if (!session.resyncing) return;
    session.resyncing = false;
    session.resyncDeadline = undefined;
    void this.broadcastResyncFrame(session.id);
  }

  private async broadcastResyncFrame(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    await session.mirror?.afterWrite();
    const frame = this.getReplaySnapshot(id);
    // 'refresh', like the scrollback purge: unsolicited, so a client scrolled up
    // in history keeps its viewport and picks the frame up on its next join.
    if (frame) this.io?.to(id).emit('session:replay', { sessionId: id, ...frame, reason: 'refresh' });
  }

  writeToSession(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    if (session.status === 'exited') return;

    // A forwarded wheel report is a scroll gesture, not user input. The backend
    // routes it: tmux via send-keys -l to the pane (tmux 3.6b drops injected
    // mouse reports as client input); daemon via a plain pty write. Returning
    // early keeps scrolling from tripping hasUserInputSinceIdle / clearing 'done'.
    if (isWheelReport(data)) {
      this.backend.writeWheel(id, session.pty, data);
      return;
    }

    session.suppressDonePromotion = false;
    session.hasUserInputSinceIdle = true;
    // User sent input — exit sticky-done so StateDetector can track the new run.
    if (session.status === 'done') {
      session.status = 'idle';
      this.io?.emit('session:status', { sessionId: id, status: 'idle' });
    }
    session.pty.write(data);
  }

  resizeSession(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    if (session.status === 'exited') return;
    // Clients refit on plenty of triggers that don't change the grid (visibility,
    // global terminal:refit, a sibling tile appearing). Re-applying the same size
    // is a no-op at the ioctl (TIOCSWINSZ only signals on an actual change) but it
    // still re-stamps the detector's RESIZE_GRACE_MS window, which suppresses the
    // 'running' heuristic for 2s. Drop the repeat here so state detection stays sharp.
    if (session.cols === cols && session.rows === rows) return;
    // A width change invalidates the wrap of everything already on screen; a
    // height change doesn't. Only the former leaves stale rows behind.
    const widthChanged = session.cols !== undefined && session.cols !== cols;
    session.pty.resize(cols, rows);
    session.stateDetector.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
    if (widthChanged) {
      // Everything already in the buffer is pre-resize content; the agent's
      // SIGWINCH repaint appends after it. Recorded *after* stateDetector.resize
      // above, which resizes the mirror: narrowing reflows rows, so an index taken
      // before it would point somewhere else entirely.
      session.trimBoundary = session.mirror?.totalRows();
      // Deferred only. There is nothing to delete until the agent has actually
      // reprinted, so an immediate pass would find no duplicate and do nothing.
      this.scheduleScrollbackTrim(session);
    }
  }

  /** Serialize trims so two purge+broadcast pairs can't interleave. */
  private chainTrim(session: ManagedSession, run: () => Promise<void>): void {
    session.trimPromise = session.trimPromise ? session.trimPromise.then(run, run) : run();
  }

  /**
   * Arm (or push back) the quiet-check that drops scrollback wrapped for a width
   * this session no longer has. Debounced: a burst of width changes — a drag that
   * slipped through, a window resize — waits once, not once per step.
   */
  private scheduleScrollbackTrim(session: ManagedSession): void {
    session.trimDeadline ??= Date.now() + TRIM_MAX_WAIT_MS;
    if (session.trimTimer) clearTimeout(session.trimTimer);
    session.trimTimer = setTimeout(() => this.runScrollbackTrim(session), TRIM_QUIET_MS);
  }

  private runScrollbackTrim(session: ManagedSession): void {
    session.trimTimer = undefined;
    // Still streaming? The repaint whose leftovers we're here to remove hasn't
    // finished, so trimming now would drop rows and keep the stale ones. Re-arm —
    // but not forever: a session streaming for minutes still deserves the trim.
    if (
      session.stateDetector.msSinceLastFeed() < TRIM_QUIET_MS &&
      Date.now() < (session.trimDeadline ?? 0)
    ) {
      session.trimTimer = setTimeout(() => this.runScrollbackTrim(session), TRIM_QUIET_MS);
      return;
    }
    session.trimDeadline = undefined;
    this.chainTrim(session, () => this.dedupeScrollback(session.id));
  }

  /**
   * Delete the stale copy the agent leaves behind when it reprints its transcript
   * after a width change — and nothing else.
   *
   * This replaces an earlier all-or-nothing purge that dropped the whole
   * scrollback. That had to ship opt-in and off, because width changes are
   * ordinary navigation here (mosaic↔Focus, window resize, tile drag) and losing
   * scroll history reads far worse than a wrongly-wrapped block. Matching the
   * duplicate instead means the destructive case is gone: when nothing matches
   * confidently, nothing is removed, so the worst outcome is the duplicate
   * staying visible — exactly the old default.
   */
  private async dedupeScrollback(id: string): Promise<void> {
    const session = this.sessions.get(id);
    const mirror = session?.mirror;
    const boundary = session?.trimBoundary;
    if (!session || !mirror || boundary === undefined) return;
    session.trimBoundary = undefined;

    // Pending bytes are part of the repaint we are measuring.
    this.flushOutput(id);
    await mirror.afterWrite();

    // Saturated scrollback evicts its oldest row on every scroll, so `boundary`
    // no longer points at the content it was taken from. Guessing here could
    // delete live output; skipping only leaves the duplicate visible.
    if (mirror.scrollbackFull()) return;

    const total = mirror.totalRows();
    if (boundary >= total) return; // the agent printed nothing after the resize

    const range = findStaleRowRange(
      mirror.readRows(0, boundary),
      mirror.readRows(boundary, total),
      MIN_DEDUP_CHARS,
    );
    if (!range) return;

    await mirror.rebuildWithout(range.start, range.end);
    const frame = this.getReplaySnapshot(id);
    // 'refresh': unsolicited, so a client whose user is scrolled up may ignore it
    // rather than have its viewport yanked to the bottom.
    if (frame) this.io?.to(id).emit('session:replay', { sessionId: id, ...frame, reason: 'refresh' });
  }

  /**
   * The room emptied. Arm the idle resize rather than doing it now: a dropped
   * socket is usually a viewer that is about to come back, and resizing on the
   * way out plus again on the way in makes the agent repaint twice — every
   * session at once, right in the middle of a reconnect. See IdleGeometryGate.
   */
  scheduleIdleGeometry(id: string): void {
    this.idleGeometry.schedule(id);
  }

  /** A viewer is watching again (join, or a fresh size report). */
  cancelIdleGeometry(id: string): void {
    this.idleGeometry.cancel(id);
  }

  /**
   * No client is watching this session any more — give it a screen tall enough
   * that the agent's repaints fit (see IDLE_MIN_ROWS). Runs from the gate once
   * the session has stayed unattached for IDLE_GEOMETRY_DELAY_MS; the rejoin's
   * resize-before-join snaps the grid back to the real tile.
   */
  applyIdleGeometry(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    // Raced with the session going away or a viewer returning between the
    // timer firing and here.
    if (session.status === 'exited') return;
    const cols = session.cols ?? SPAWN_COLS;
    const rows = session.rows ?? SPAWN_ROWS;
    if (rows >= IDLE_MIN_ROWS) return;
    this.resizeSession(id, cols, IDLE_MIN_ROWS);
  }

  async restoreSessions(): Promise<void> {
    const persisted = await this.store.load();

    // Scan for survivors once: sessions still alive from a previous run (tmux
    // sessions, or daemon sessions the daemon kept across our restart).
    await this.backend.ready?.();
    const survivors = await this.backend.listSurvivors(); // session ids
    const knownIds = new Set<string>();

    for (const p of persisted) {
      knownIds.add(p.id);

      try {
        await access(p.folderPath);
      } catch {
        console.warn(`Skipping session "${p.name}": folder not accessible (${p.folderPath})`);
        continue;
      }

      // Decide whether a live agent survived to re-attach to.
      let attach = false;
      if (survivors.has(p.id)) {
        if (this.backend.isSurvivorDead(p.id)) {
          // Agent exited while detached — discard the dead session and start fresh.
          this.backend.stopSession(p.id);
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

    // Reap orphan survivors with no matching persisted record (sessions.json
    // deleted, or a crash left them behind).
    await this.backend.reapOrphans(knownIds);

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
        session.mirror?.dispose();
        this.backend.detach(session.pty); // detach only; agent survives the quit
      } catch {
        // pty may already be dead — continue to next session
      }
    }
    await this.fileWatcher.stopAll();
    await this.sleepPrevention.release('sessions');
    await this.persistSessions();
  }

  /**
   * "Quit & Stop All Sessions": actually terminate every agent (not just detach),
   * then run the normal shutdown. Kills the whole argus tmux server to be sure.
   */
  async stopAllAndShutdown(): Promise<void> {
    this.backend.stopAll(); // terminate every agent (tmux: kill server; daemon: kill-all + exit)
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
