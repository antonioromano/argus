/**
 * Defers the "no one is watching → give it a tall screen" resize.
 *
 * Applying it the instant a room empties turns every transient viewer loss into
 * a SIGWINCH, and the rejoin into a second one. The agent repaints on each, so a
 * single dropped socket makes *every* session reprint at once — a synchronized
 * output burst arriving exactly when the app is already busy reconnecting. With
 * a dozen-plus sessions that burst is what the app can't absorb.
 *
 * A viewer that comes back within the grace window therefore costs zero
 * resizes. Genuinely unattached sessions still get the idle floor, just late,
 * which is all that behaviour ever needed (see IDLE_MIN_ROWS).
 */
export class IdleGeometryGate {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly delayMs: number,
    private readonly apply: (sessionId: string) => void,
  ) {}

  /** Arm the idle resize. A second call while one is pending keeps the first
   *  deadline — repeated leave/disconnect churn must not push it out forever. */
  schedule(sessionId: string): void {
    if (this.timers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      this.apply(sessionId);
    }, this.delayMs);
    timer.unref?.();
    this.timers.set(sessionId, timer);
  }

  /** A viewer is back (or the session is gone): the idle resize is moot. */
  cancel(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(sessionId);
  }

  isPending(sessionId: string): boolean {
    return this.timers.has(sessionId);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
