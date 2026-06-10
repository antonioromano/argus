const WINDOW_MS = 15 * 60 * 1000; // 15 min rolling window
const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 min lockout after exceeding limit

interface IPState {
  attempts: number;
  lockedUntil: number | null;
  windowStart: number;
}

export class LoginRateLimiter {
  private readonly state = new Map<string, IPState>();

  /** Returns null if allowed, or a human-readable reason string if blocked. */
  check(ip: string): string | null {
    const now = Date.now();
    let s = this.state.get(ip);

    if (!s || now - s.windowStart > WINDOW_MS) {
      s = { attempts: 0, lockedUntil: null, windowStart: now };
      this.state.set(ip, s);
    }

    if (s.lockedUntil !== null && now < s.lockedUntil) {
      const secs = Math.ceil((s.lockedUntil - now) / 1000);
      return `Too many failed attempts. Try again in ${secs}s.`;
    }

    return null;
  }

  /** Call after a failed login attempt. */
  recordFailure(ip: string): void {
    const now = Date.now();
    let s = this.state.get(ip);
    if (!s || now - s.windowStart > WINDOW_MS) {
      s = { attempts: 0, lockedUntil: null, windowStart: now };
      this.state.set(ip, s);
    }
    s.attempts++;
    if (s.attempts >= MAX_ATTEMPTS) {
      s.lockedUntil = now + LOCKOUT_MS;
    }
  }

  /** Reset state after a successful login. */
  reset(ip: string): void {
    this.state.delete(ip);
  }
}
