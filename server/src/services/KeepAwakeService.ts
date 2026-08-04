import type { KeepAwakeStatus } from '@argus/shared';
import type { SleepPreventionService } from './SleepPreventionService.js';

/** The only windows the UI offers, and the only ones the API accepts. */
export const KEEP_AWAKE_DURATIONS_MS: readonly number[] = [
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  120 * 60_000,
  240 * 60_000,
];

/**
 * `null` means "indefinitely". Anything outside the allowlist is rejected rather
 * than clamped — an unexpected value means a bug or a hand-rolled request, and
 * silently arming some other duration would be worse than a 400.
 */
export function isKeepAwakeDuration(v: unknown): v is number | null {
  if (v === null) return true;
  return typeof v === 'number' && KEEP_AWAKE_DURATIONS_MS.includes(v);
}

/** Returns a cancel function. Injected so expiry is testable without fake timers. */
export type Scheduler = (fn: () => void, ms: number) => () => void;

const realScheduler: Scheduler = (fn, ms) => {
  const t = setTimeout(fn, ms);
  t.unref(); // a pending window must never keep the process alive
  return () => clearTimeout(t);
};

/**
 * Owns the manual keep-awake window: one expiry, one timer, and the 'manual'
 * hold on the shared sleep blocker.
 *
 * Expiry is server-side on purpose — the client only renders a countdown from
 * `expiresAt`, so a reloaded renderer, a second window or a paused laptop can
 * never lose or double-release the hold. Deliberately not persisted: an armed
 * window dies with the app, matching Amphetamine's session-scoped behavior.
 */
export class KeepAwakeService {
  private expiresAt: number | null = null;
  private indefinite = false;
  private cancelTimer: (() => void) | null = null;
  private readonly listeners: ((s: KeepAwakeStatus) => void)[] = [];

  constructor(
    private readonly sleep: SleepPreventionService,
    private readonly now: () => number = Date.now,
    private readonly schedule: Scheduler = realScheduler,
  ) {}

  get status(): KeepAwakeStatus {
    return {
      active: this.indefinite || this.expiresAt !== null,
      expiresAt: this.expiresAt,
      indefinite: this.indefinite,
    };
  }

  onChange(cb: (s: KeepAwakeStatus) => void): void {
    this.listeners.push(cb);
  }

  /** `durationMs === null` arms indefinitely. Re-arming replaces the window. */
  async arm(durationMs: number | null): Promise<KeepAwakeStatus> {
    this.clearTimer();

    if (durationMs === null) {
      this.indefinite = true;
      this.expiresAt = null;
    } else {
      this.indefinite = false;
      this.expiresAt = this.now() + durationMs;
      this.cancelTimer = this.schedule(() => { void this.disarm(); }, durationMs);
    }

    try {
      await this.sleep.acquire('manual');
    } catch (err) {
      // Never report an armed window over a blocker that failed to start.
      this.reset();
      throw err;
    }

    this.emit();
    return this.status;
  }

  async disarm(): Promise<KeepAwakeStatus> {
    this.reset();
    await this.sleep.release('manual');
    this.emit();
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.reset();
    await this.sleep.release('manual');
  }

  private reset(): void {
    this.clearTimer();
    this.expiresAt = null;
    this.indefinite = false;
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private emit(): void {
    const s = this.status;
    for (const cb of this.listeners) cb(s);
  }
}
