import type { BackendHealth } from '@argus/shared';

/** What a pty backend reports about its own transport. */
export type BackendHealthEvent = 'connected' | 'disconnected' | 'versionMismatch';

/** A drop shorter than this never shows: argusd reconnects in well under a second. */
export const RECONNECTING_AFTER_MS = 1000;
/** Still gone after this long → the status bar says the daemon is down. */
export const DOWN_AFTER_MS = 10_000;

/**
 * Turns argusd connection events into the state the status bar shows (plan
 * 009 S1), debounced so a flap (drop → reconnect inside a second) never
 * flashes anything, and emitting only on change. tmux has no connection, so
 * its tracker sits at `ok` forever. `drain` (a different argusd version) sticks:
 * that daemon stays mismatched until its sessions end.
 */
export class BackendHealthTracker {
  private state: BackendHealth['state'] = 'ok';
  private reconnectingTimer: ReturnType<typeof setTimeout> | null = null;
  private downTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly kind: BackendHealth['kind'],
    private readonly onChange: (health: BackendHealth) => void,
    private readonly delays = { reconnectingAfterMs: RECONNECTING_AFTER_MS, downAfterMs: DOWN_AFTER_MS },
  ) {}

  current(): BackendHealth {
    return { kind: this.kind, state: this.state };
  }

  handle(event: BackendHealthEvent): void {
    if (event === 'versionMismatch') {
      this.clearTimers();
      this.set('drain');
      return;
    }
    if (event === 'connected') {
      this.clearTimers();
      if (this.state !== 'drain') this.set('ok');
      return;
    }
    // disconnected
    if (this.state === 'drain' || this.reconnectingTimer || this.downTimer) return;
    this.reconnectingTimer = setTimeout(() => {
      this.reconnectingTimer = null;
      this.set('reconnecting');
    }, this.delays.reconnectingAfterMs);
    this.downTimer = setTimeout(() => {
      this.downTimer = null;
      this.set('down');
    }, this.delays.downAfterMs);
    this.reconnectingTimer.unref?.();
    this.downTimer.unref?.();
  }

  dispose(): void {
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.reconnectingTimer) clearTimeout(this.reconnectingTimer);
    if (this.downTimer) clearTimeout(this.downTimer);
    this.reconnectingTimer = null;
    this.downTimer = null;
  }

  private set(next: BackendHealth['state']): void {
    if (next === this.state) return;
    this.state = next;
    this.onChange(this.current());
  }
}
