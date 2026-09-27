import type { IPty } from 'node-pty';
import type { PtyManager } from '../PtyManager.js';
import type { TerminalMirror } from '../TerminalMirror.js';
import type { PtyBackend, SpawnOpts } from './types.js';

/**
 * Direct run mode: the agent is spawned with plain node-pty — `$SHELL -l -c
 * "exec <agent>"` in the session folder, the same path the ⌘T shell and the
 * tmux-unavailable fallback use. Nothing sits between the agent and the
 * terminal, and nothing survives an Argus quit: detach kills, there are never
 * survivors to reattach, and restore brings the session back as an exited
 * placeholder (see SessionManager.restoreSessions).
 */
export class DirectBackend implements PtyBackend {
  readonly kind = 'direct' as const;
  private readonly ptys = new Map<string, IPty>();

  constructor(private readonly pty: Pick<PtyManager, 'spawn'>) {}

  isPersistent(): boolean { return false; }

  spawn(o: SpawnOpts): IPty {
    // attachExisting never applies: there is nothing to attach to.
    const p = this.pty.spawn(o.folderPath, o.command, o.cols, o.rows, o.flags, o.extraEnv);
    this.ptys.set(o.sessionId, p);
    return p;
  }

  seedMirror(_sessionId: string, _mirror: TerminalMirror): void {
    // The mirror is fed by the raw stream; there is no pre-attach history.
  }

  writeWheel(_sessionId: string, pty: IPty, data: string): void {
    pty.write(data); // no multiplexer in the way
  }

  detach(pty: IPty): void {
    try { pty.kill(); } catch { /* already gone */ }
    for (const [id, p] of this.ptys) if (p === pty) this.ptys.delete(id);
  }

  stopSession(sessionId: string): void {
    const p = this.ptys.get(sessionId);
    this.ptys.delete(sessionId);
    try { p?.kill(); } catch { /* already gone */ }
  }

  stopAll(): void {
    for (const id of [...this.ptys.keys()]) this.stopSession(id);
  }

  async listSurvivors(): Promise<Set<string>> { return new Set(); }
  isSurvivorDead(_sessionId: string): boolean { return true; }
  async reapOrphans(_knownIds: Set<string>): Promise<void> {}
}
