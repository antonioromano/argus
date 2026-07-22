import type { IPty } from 'node-pty';
import { DaemonClient, DaemonPty } from '../daemon/DaemonClient.js';
import { shquote } from '../PtyManager.js';
import type { TerminalMirror } from '../TerminalMirror.js';
import type { PtyBackend, SpawnOpts } from './types.js';

/**
 * Backend backed by the argusd pty-host daemon (plan 2026-07-22-003). Sessions
 * survive app quit because the daemon outlives it; bytes flow untouched, so the
 * tmux byte-mangling class (mouse rewriting, locale downgrade, capture-pane)
 * disappears. EXPERIMENTAL — gated behind ARGUS_PTY_BACKEND=daemon (default
 * tmux) and pending live soak; the restart-race + reconnect-health edges still
 * need real-app verification.
 */
export class DaemonBackend implements PtyBackend {
  readonly kind = 'daemon' as const;
  private client: DaemonClient;
  private ptys = new Map<string, DaemonPty>();

  constructor(socketPath: string, binPath: string, socketLabel: string) {
    this.client = new DaemonClient(socketPath, binPath, socketLabel);
  }

  async ready(): Promise<void> {
    await this.client.ensureConnected();
  }

  isPersistent(): boolean {
    return true; // the daemon outlives the app
  }

  spawn(o: SpawnOpts): IPty {
    this.ptys.get(o.sessionId)?.dispose(); // drop a stale adapter (restart reuse)
    const pty = new DaemonPty(this.client, o.sessionId);
    this.ptys.set(o.sessionId, pty);
    if (o.attachExisting) {
      this.client.attach(o.sessionId); // replays the ring → onData → mirror
    } else {
      const shell = process.env.SHELL || '/bin/zsh';
      const flagStr = o.flags.length ? ' ' + o.flags.map(shquote).join(' ') : '';
      const argv = [shell, '-l', '-c', `exec ${o.command}${flagStr}`];
      this.client.spawn(o.sessionId, argv, o.folderPath, o.extraEnv, o.cols, o.rows);
    }
    return pty as unknown as IPty;
  }

  seedMirror(_sessionId: string, _mirror: TerminalMirror): void {
    // No-op: attach already replayed the daemon's ring through the pty's onData
    // into the mirror (no separate capture step, unlike tmux).
  }

  writeWheel(_sessionId: string, pty: IPty, data: string): void {
    pty.write(data); // no multiplexer in the way — a plain pty write scrolls the app
  }

  detach(pty: IPty): void {
    // App quit: dropping the socket keeps the daemon + agents alive. Just stop
    // this adapter from receiving; never kill the session here.
    (pty as unknown as DaemonPty).dispose();
  }

  stopSession(sessionId: string): void {
    this.client.kill(sessionId);
    this.ptys.get(sessionId)?.dispose();
    this.ptys.delete(sessionId);
  }

  stopAll(): void {
    this.client.killAll();
  }

  async listSurvivors(): Promise<Set<string>> {
    if (!this.client.isConnected()) return new Set();
    return new Set(await this.client.list());
  }

  isSurvivorDead(_sessionId: string): boolean {
    // The daemon removes a session from its table when its process exits, so a
    // listed survivor is by definition alive.
    return false;
  }

  async reapOrphans(knownIds: Set<string>): Promise<void> {
    if (!this.client.isConnected()) return;
    for (const id of await this.client.list()) {
      if (!knownIds.has(id)) this.client.kill(id);
    }
  }
}
