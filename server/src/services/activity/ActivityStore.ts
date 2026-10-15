import type { ActivityEvent } from '@argus/shared';

/** Entries kept per session; the oldest falls off. */
export const ACTIVITY_RING_CAP = 500;

/**
 * Beta F6: in-memory ring of the last N activity entries per session. Nothing
 * is written to disk; a session's ring goes with the session (`drop`), and the
 * whole store empties when the feature is switched off (`clear`).
 */
export class ActivityStore {
  private rings = new Map<string, ActivityEvent[]>();
  private seq = 0;

  constructor(
    private readonly cap = ACTIVITY_RING_CAP,
    private readonly now: () => number = Date.now,
  ) {}

  append(sessionId: string, entry: Omit<ActivityEvent, 'id' | 'at'>): ActivityEvent {
    const event: ActivityEvent = { id: ++this.seq, at: this.now(), ...entry };
    let ring = this.rings.get(sessionId);
    if (!ring) {
      ring = [];
      this.rings.set(sessionId, ring);
    }
    ring.push(event);
    if (ring.length > this.cap) ring.splice(0, ring.length - this.cap);
    return event;
  }

  /** Oldest first; a copy. */
  list(sessionId: string): ActivityEvent[] {
    return [...(this.rings.get(sessionId) ?? [])];
  }

  drop(sessionId: string): void {
    this.rings.delete(sessionId);
  }

  clear(): void {
    this.rings.clear();
  }
}
