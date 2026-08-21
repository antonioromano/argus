import type { IPty } from 'node-pty';
import { DaemonClient, DaemonPty } from '../daemon/DaemonClient.js';
import { shquote } from '../PtyManager.js';
import type { TerminalMirror } from '../TerminalMirror.js';
import type { PtyBackend, SpawnOpts } from './types.js';

/** How long a restart waits for the killed agent's exit before giving up on it. */
const STOP_EXIT_TIMEOUT_MS = 2_000;

/**
 * Backend backed by the argusd pty-host daemon (plan 2026-07-22-003). Sessions
 * survive app quit because the daemon outlives it; bytes flow untouched, so the
 * tmux byte-mangling class (mouse rewriting, locale downgrade, capture-pane)
 * disappears. This is the DEFAULT backend whenever the argusd binary resolves
 * ('auto'); tmux is the fallback. Losing and regaining the socket is a normal
 * event — the daemon drops a consumer that stops draining it — so reconnect and
 * re-attach are part of the contract, not an edge case.
 */
export class DaemonBackend implements PtyBackend {
  readonly kind = 'daemon' as const;
  private client: DaemonClient;
  private ptys = new Map<string, DaemonPty>();

  private resyncCb: ((sessionId: string) => void) | null = null;

  constructor(socketPath: string, binPath: string, socketLabel: string) {
    this.client = new DaemonClient(socketPath, binPath, socketLabel);
    // The daemon drops a consumer it judges dead (outbox overflow / write
    // timeout) and keeps the agents running. When we get back, nothing is
    // subscribed any more: every session must be re-attached or its terminal
    // stays frozen for the rest of the app's life.
    this.client.on('reconnected', () => this.reattachAll());
  }

  private reattachAll(): void {
    console.log(`[argusd] re-attaching ${this.ptys.size} session(s) after reconnect`);
    for (const sessionId of this.ptys.keys()) {
      // Wipe the mirror first: attach replays the session's whole ring, which
      // overlaps whatever we already had.
      this.resyncCb?.(sessionId);
      this.client.attach(sessionId);
    }
  }

  onSessionResync(cb: (sessionId: string) => void): void {
    this.resyncCb = cb;
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

  /**
   * Stop and wait until the daemon has reported the agent gone. Killing is
   * asynchronous over the socket and exit frames carry only a session id, so a
   * restart that spawns before the old exit arrives gets that exit delivered to
   * the FRESH pty. Bounded by a timeout: a missing exit must not wedge restart.
   */
  async stopSessionAndWait(sessionId: string): Promise<void> {
    if (!this.client.isConnected()) {
      this.stopSession(sessionId);
      return;
    }
    // Nothing to wait for when the daemon no longer holds the session.
    const alive = (await this.client.list()).includes(sessionId);
    if (!alive) {
      this.stopSession(sessionId);
      return;
    }
    const exited = this.client.waitForExit(sessionId, STOP_EXIT_TIMEOUT_MS);
    this.stopSession(sessionId);
    await exited;
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
