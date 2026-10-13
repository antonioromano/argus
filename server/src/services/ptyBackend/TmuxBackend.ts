import type { IPty } from 'node-pty';
import { PtyManager, tmuxSessionName } from '../PtyManager.js';
import { MIRROR_SCROLLBACK } from '../TerminalMirror.js';
import type { TerminalMirror } from '../TerminalMirror.js';
import type { PtyBackend, SpawnOpts } from './types.js';

const TMUX_NAME_PREFIX = 'argus-';

/**
 * Wheel reports arriving within this window are batched into one `send-keys`.
 * A trackpad flick emits dozens of reports a second, each of which used to be
 * its own tmux fork.
 */
export const WHEEL_COALESCE_MS = 16;

/**
 * How long a restore's one-shot pane snapshot answers per-session pane
 * questions (dead? alternate screen?) before we ask tmux again. A restore asks
 * them for every survivor within a few seconds of the snapshot; outside that
 * window (a later restart, diagnostics) each question goes to tmux directly.
 */
export const PANE_SNAPSHOT_TTL_MS = 10_000;

interface PaneSnapshot {
  at: number;
  panes: Map<string, { dead: boolean; alternate: boolean }>;
}

interface WheelBatch {
  /** Reports queued since the window opened (sent at its close). */
  pending: string;
  timer: ReturnType<typeof setTimeout> | null;
  /** Sends for this session, in order — async forks must not reorder ticks. */
  chain: Promise<void>;
  /** Sends queued on `chain` that have not finished yet. */
  inFlight: number;
}

/**
 * The default backend: sessions live in tmux. A thin delegation layer over the
 * existing PtyManager — behavior is unchanged from before the backend seam, and
 * SessionManager's tests (which stub PtyManager methods) still hit them through
 * here. The tmux-specific seed (capture-pane) and wheel (send-keys) logic that
 * used to sit inline in SessionManager lives here now.
 */
export class TmuxBackend implements PtyBackend {
  readonly kind = 'tmux' as const;

  private wheel = new Map<string, WheelBatch>();
  /** One `list-panes -a` per restore, shared by every survivor's checks. */
  private paneSnapshot: PaneSnapshot | null = null;

  constructor(private pty: PtyManager) {}

  isPersistent(): boolean {
    return this.pty.isTmuxAvailable();
  }

  spawn(o: SpawnOpts): IPty {
    if (this.pty.isTmuxAvailable()) {
      return this.pty.spawnTmux(
        tmuxSessionName(o.sessionId),
        o.folderPath,
        o.command,
        o.cols,
        o.rows,
        o.flags,
        o.extraEnv,
      );
    }
    return this.pty.spawn(o.folderPath, o.command, o.cols, o.rows, o.flags, o.extraEnv);
  }

  seedMirror(sessionId: string, mirror: TerminalMirror): void {
    if (!this.pty.isTmuxAvailable()) return;
    const name = tmuxSessionName(sessionId);
    try {
      const snap = this.freshPane(name);
      if (snap ? snap.dead : this.pty.isTmuxPaneDead(name)) return;
      // Alt-screen apps have no meaningful scrollback and the attach repaint
      // reconstructs them; a text seed would fight the repaint's ?1049h.
      if (snap ? snap.alternate : this.pty.captureState(name).alternate) return;
      const seed = this.pty
        .capturePane(name, MIRROR_SCROLLBACK)
        .replace(/\n$/, '')
        .replace(/\r?\n/g, '\r\n');
      if (seed) {
        mirror.markSeeding();
        void mirror.feed(seed).then(() => mirror.clearSeeding());
      }
    } catch {
      /* pane gone / tmux hiccup — live repaint still reconstructs the screen */
    }
  }

  /**
   * Leading + trailing throttle: the first report of a burst goes out at once
   * (no added latency for a single tick); reports arriving in the next
   * WHEEL_COALESCE_MS are concatenated and sent as one `send-keys -l` when the
   * window closes. The pane receives the same byte sequence, in order.
   */
  writeWheel(sessionId: string, pty: IPty, data: string): void {
    if (!this.pty.isTmuxAvailable()) {
      pty.write(data);
      return;
    }
    let batch = this.wheel.get(sessionId);
    if (!batch) {
      batch = { pending: '', timer: null, chain: Promise.resolve(), inFlight: 0 };
      this.wheel.set(sessionId, batch);
    }
    if (batch.timer) {
      batch.pending += data; // inside the window: join the trailing send
      return;
    }
    this.sendWheel(sessionId, batch, data);
    const b = batch;
    b.timer = setTimeout(() => {
      b.timer = null;
      const queued = b.pending;
      b.pending = '';
      if (queued) this.sendWheel(sessionId, b, queued);
      else if (b.inFlight === 0) this.wheel.delete(sessionId);
    }, WHEEL_COALESCE_MS);
    b.timer.unref?.();
  }

  private sendWheel(sessionId: string, batch: WheelBatch, data: string): void {
    const name = tmuxSessionName(sessionId);
    const send = (): Promise<void> => {
      let p: Promise<void>;
      try {
        // Promise.resolve: tolerate a synchronous stub/legacy implementation.
        p = Promise.resolve(this.pty.sendKeysLiteral(name, data));
      } catch (err) {
        p = Promise.reject(err);
      }
      return p
        .catch(() => {
          /* session may be gone */
        })
        .finally(() => {
          batch.inFlight--;
          if (batch.inFlight === 0 && !batch.timer && this.wheel.get(sessionId) === batch) {
            this.wheel.delete(sessionId);
          }
        });
    };
    // An idle session sends synchronously, so a single tick has no added
    // latency; a send still in flight makes later ones wait their turn.
    batch.chain = batch.inFlight === 0 ? send() : batch.chain.then(send);
    batch.inFlight++;
  }

  detach(pty: IPty): void {
    this.pty.kill(pty); // detaches the tmux client; agent survives
  }

  stopSession(sessionId: string): void {
    // A killed name must not answer from the snapshot: a respawn on the same id
    // is a different (live, normal-screen) pane.
    this.paneSnapshot?.panes.delete(tmuxSessionName(sessionId));
    if (this.pty.isTmuxAvailable()) this.pty.killTmuxSession(tmuxSessionName(sessionId));
  }

  stopAll(): void {
    if (this.pty.isTmuxAvailable()) this.pty.killTmuxServer();
  }

  /**
   * One `list-panes -a` answers the whole restore: which survivors exist, and
   * (cached for PANE_SNAPSHOT_TTL_MS) whether each is dead or on the alternate
   * screen — instead of a list-sessions plus two forks per survivor.
   */
  async listSurvivors(): Promise<Set<string>> {
    if (!this.pty.isTmuxAvailable()) return new Set();
    const panes = this.pty.listPaneStates();
    this.paneSnapshot = { at: Date.now(), panes };
    const ids = new Set<string>();
    for (const name of panes.keys()) {
      ids.add(name.startsWith(TMUX_NAME_PREFIX) ? name.slice(TMUX_NAME_PREFIX.length) : name);
    }
    return ids;
  }

  isSurvivorDead(sessionId: string): boolean {
    const name = tmuxSessionName(sessionId);
    const snap = this.freshPane(name);
    return snap ? snap.dead : this.pty.isTmuxPaneDead(name);
  }

  /** The restore snapshot's entry for a session, if the snapshot is fresh. */
  private freshPane(name: string): { dead: boolean; alternate: boolean } | undefined {
    const snap = this.paneSnapshot;
    if (!snap) return undefined;
    if (Date.now() - snap.at > PANE_SNAPSHOT_TTL_MS) {
      this.paneSnapshot = null;
      return undefined;
    }
    return snap.panes.get(name);
  }

  async reapOrphans(knownIds: Set<string>): Promise<void> {
    if (!this.pty.isTmuxAvailable()) return;
    for (const name of this.pty.listArgusSessions()) {
      const id = name.startsWith(TMUX_NAME_PREFIX) ? name.slice(TMUX_NAME_PREFIX.length) : name;
      if (!knownIds.has(id)) this.pty.killTmuxSession(name);
    }
  }
}
