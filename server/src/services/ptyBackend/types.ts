import type { IPty } from 'node-pty';
import type { TerminalMirror } from '../TerminalMirror.js';

export interface SpawnOpts {
  sessionId: string;
  folderPath: string;
  command: string;
  cols: number;
  rows: number;
  flags: string[];
  extraEnv: Record<string, string>;
  /** Re-attach to an existing survivor rather than spawn fresh. */
  attachExisting: boolean;
}

/**
 * The process-survival + pty layer behind a session, abstracted so SessionManager
 * works the same whether sessions live in tmux or the argusd daemon (plan
 * 2026-07-22-003). TmuxBackend delegates to the existing PtyManager (behavior
 * unchanged); DaemonBackend drives a DaemonClient. Selected by ARGUS_PTY_BACKEND
 * (default 'tmux' for one release).
 */
export interface PtyBackend {
  readonly kind: 'tmux' | 'daemon';

  /** True when sessions survive an app quit. */
  isPersistent(): boolean;

  /** Spawn (or re-attach, when attachExisting) a session; returns its IPty handle. */
  spawn(opts: SpawnOpts): IPty;

  /**
   * Seed a survivor's fresh mirror with pre-attach history. tmux: one
   * capture-pane feed (normal screen only). daemon: no-op — attach already
   * replayed the ring through the pty's onData into the mirror.
   */
  seedMirror(sessionId: string, mirror: TerminalMirror): void;

  /**
   * Route a forwarded wheel report. tmux: send-keys -l to the pane (tmux 3.6b
   * drops injected mouse reports as client input). daemon: plain pty write —
   * no multiplexer in the way.
   */
  writeWheel(sessionId: string, pty: IPty, data: string): void;

  /** Detach our client without stopping the agent (app quit → survive). */
  detach(pty: IPty): void;

  /** Terminate the agent for one session (destroy/restart). */
  stopSession(sessionId: string): void;

  /** Terminate every agent (Quit & Stop All). */
  stopAll(): void;

  /** Session ids of survivors alive from a previous run (restore scan). Async
   *  because the daemon answers over the socket. */
  listSurvivors(): Promise<Set<string>>;

  /** True if a survivor's process has already exited. */
  isSurvivorDead(sessionId: string): boolean;

  /** Kill survivors with no matching persisted record (orphan cleanup on restore). */
  reapOrphans(knownIds: Set<string>): Promise<void>;

  /** Establish any connection the backend needs before spawn/list (daemon: connect
   *  + handshake). No-op for tmux. Awaited by SessionManager before first use. */
  ready?(): Promise<void>;

  /**
   * Register a callback fired just before the backend replays a session's
   * history from scratch, because its transport was re-established (daemon
   * reconnect). The mirror holds pre-drop state that the replay is about to
   * repeat, so SessionManager wipes it and withholds client output until the
   * replay settles. tmux has no such transport, so it never registers.
   */
  onSessionResync?(cb: (sessionId: string) => void): void;
}
