import type { StateDetectorClock, StateDetectorTimer } from './StateDetector.js';

/**
 * Virtual clock for StateDetector tests.
 *
 * The detector is entirely time-gated (500ms output settle, 300ms commit
 * debounce, 150ms activity window), so tests used to sleep ~900ms of real time
 * per assertion. That was slow (~30s across the three test files) and flaky: on
 * a loaded box the detector's internal timers fire late and the sleep wins the
 * race, so a correct classification reads as a wrong one.
 *
 * `advance()` fires the detector's due timers in chronological order instead of
 * waiting for them. Timers scheduled *by* a firing timer are picked up in the
 * same sweep, which matters because the real sequence is chained: idle settle
 * (500ms) → classify → commit debounce (300ms) → status change.
 *
 * Only the detector's own timers are virtual. TerminalMirror's write queue and
 * xterm's parser still run on real timers and promises — faking those globally
 * is what makes `mirror.afterWrite()` hang forever — so every step yields to the
 * real queues via `drain()` before the next timer fires.
 */
export class FakeClock implements StateDetectorClock {
  private t: number;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  constructor(startMs = 1_700_000_000_000) {
    this.t = startMs;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): StateDetectorTimer {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: StateDetectorTimer): void {
    if (typeof handle === 'number') this.timers.delete(handle);
  }

  /** Timers still scheduled — lets a test assert nothing was left armed. */
  get pending(): number {
    return this.timers.size;
  }

  /**
   * Move virtual time forward by `ms`, firing every timer that comes due (including
   * ones armed mid-sweep), yielding to the real event loop around each fire so the
   * mirror's async writes settle.
   */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    // Drain first: feed() classifies inside a promise callback, so the debounce
    // timer it arms may not exist yet at call time.
    await drain();
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      this.timers.delete(id);
      this.t = timer.at;
      timer.fn();
      await drain();
    }
    this.t = target;
    await drain();
  }
}

/**
 * Yield to the real macrotask queue enough times for the mirror's write chain
 * (`write` callback → `afterWrite()` promise → `.then()` classify) to settle.
 * Each round is a real 0ms timer, so this costs microseconds, not the 900ms the
 * sleeps used to.
 */
async function drain(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
