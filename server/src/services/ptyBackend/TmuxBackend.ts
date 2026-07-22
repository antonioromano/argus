import type { IPty } from 'node-pty';
import { PtyManager, tmuxSessionName } from '../PtyManager.js';
import { MIRROR_SCROLLBACK } from '../TerminalMirror.js';
import type { TerminalMirror } from '../TerminalMirror.js';
import type { PtyBackend, SpawnOpts } from './types.js';

const TMUX_NAME_PREFIX = 'argus-';

/**
 * The default backend: sessions live in tmux. A thin delegation layer over the
 * existing PtyManager — behavior is unchanged from before the backend seam, and
 * SessionManager's tests (which stub PtyManager methods) still hit them through
 * here. The tmux-specific seed (capture-pane) and wheel (send-keys) logic that
 * used to sit inline in SessionManager lives here now.
 */
export class TmuxBackend implements PtyBackend {
  readonly kind = 'tmux' as const;

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
      if (this.pty.isTmuxPaneDead(name)) return;
      // Alt-screen apps have no meaningful scrollback and the attach repaint
      // reconstructs them; a text seed would fight the repaint's ?1049h.
      if (this.pty.captureState(name).alternate) return;
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

  writeWheel(sessionId: string, pty: IPty, data: string): void {
    if (this.pty.isTmuxAvailable()) {
      try {
        this.pty.sendKeysLiteral(tmuxSessionName(sessionId), data);
      } catch {
        /* session may be gone */
      }
    } else {
      pty.write(data);
    }
  }

  detach(pty: IPty): void {
    this.pty.kill(pty); // detaches the tmux client; agent survives
  }

  stopSession(sessionId: string): void {
    if (this.pty.isTmuxAvailable()) this.pty.killTmuxSession(tmuxSessionName(sessionId));
  }

  stopAll(): void {
    if (this.pty.isTmuxAvailable()) this.pty.killTmuxServer();
  }

  async listSurvivors(): Promise<Set<string>> {
    if (!this.pty.isTmuxAvailable()) return new Set();
    const ids = new Set<string>();
    for (const name of this.pty.listArgusSessions()) {
      ids.add(name.startsWith(TMUX_NAME_PREFIX) ? name.slice(TMUX_NAME_PREFIX.length) : name);
    }
    return ids;
  }

  isSurvivorDead(sessionId: string): boolean {
    return this.pty.isTmuxPaneDead(tmuxSessionName(sessionId));
  }

  async reapOrphans(knownIds: Set<string>): Promise<void> {
    if (!this.pty.isTmuxAvailable()) return;
    for (const name of this.pty.listArgusSessions()) {
      const id = name.startsWith(TMUX_NAME_PREFIX) ? name.slice(TMUX_NAME_PREFIX.length) : name;
      if (!knownIds.has(id)) this.pty.killTmuxSession(name);
    }
  }
}
