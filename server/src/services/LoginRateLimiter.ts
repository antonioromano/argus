import type { IncomingHttpHeaders } from 'http';
import { hasProxyHeaders } from '../middleware/exposure.js';

const WINDOW_MS = 15 * 60 * 1000; // 15 min rolling window
const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 min lockout after exceeding limit
/** Failures across ALL clients per window before every login is paused. High
 *  enough that one abusive client can't trip it alone (it is locked out after
 *  MAX_ATTEMPTS), low enough to cap a distributed guessing run. */
const GLOBAL_MAX_ATTEMPTS = 100;

interface IPState {
  attempts: number;
  lockedUntil: number | null;
  windowStart: number;
}

export interface LoginRateLimiterOptions {
  maxAttempts?: number;
  globalMaxAttempts?: number;
  windowMs?: number;
  lockoutMs?: number;
  now?: () => number;
}

/**
 * Who is logging in, for rate limiting. Every request through a tunnel arrives
 * from 127.0.0.1, so keying on the socket address put all remote users in ONE
 * bucket: ten wrong guesses from anyone locked everyone (the owner included)
 * out. Behind a proxy, key on the client address the proxy recorded instead.
 *
 * X-Forwarded-For is a list each hop APPENDS to; the client controls every entry
 * except the last one, which the tunnel edge added — so use the last entry. A
 * client spoofing earlier entries can't escape its bucket. No other header is
 * trusted for the key (see below).
 */
export function loginClientKey(headers: IncomingHttpHeaders, remoteAddress: string | undefined): string {
  const peer = remoteAddress ?? 'unknown';
  if (!hasProxyHeaders(headers)) return peer;
  const xff = headers['x-forwarded-for'];
  const xffValue = Array.isArray(xff) ? xff[xff.length - 1] : xff;
  const lastHop = xffValue?.split(',').map((s) => s.trim()).filter(Boolean).pop();
  if (lastHop) return `fwd:${lastHop}`;
  // Proxied but without X-Forwarded-For: X-Real-IP / Forwarded are NOT used —
  // with no proxy-appended XFF hop they are entirely client-controlled, and
  // rotating them would mint a fresh bucket per attempt. All such requests
  // share one bucket (still separate from genuinely local requests).
  return 'fwd:unknown';
}

export class LoginRateLimiter {
  private readonly state = new Map<string, IPState>();
  private global: IPState;
  private readonly maxAttempts: number;
  private readonly globalMax: number;
  private readonly windowMs: number;
  private readonly lockoutMs: number;
  private readonly now: () => number;

  constructor(opts: LoginRateLimiterOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
    this.globalMax = opts.globalMaxAttempts ?? GLOBAL_MAX_ATTEMPTS;
    this.windowMs = opts.windowMs ?? WINDOW_MS;
    this.lockoutMs = opts.lockoutMs ?? LOCKOUT_MS;
    this.now = opts.now ?? Date.now;
    this.global = this.fresh(this.now());
  }

  private fresh(now: number): IPState {
    return { attempts: 0, lockedUntil: null, windowStart: now };
  }

  private current(key: string, now: number): IPState {
    let s = this.state.get(key);
    if (!s || (now - s.windowStart > this.windowMs && !(s.lockedUntil !== null && now < s.lockedUntil))) {
      s = this.fresh(now);
      this.state.set(key, s);
    }
    return s;
  }

  private currentGlobal(now: number): IPState {
    const g = this.global;
    if (now - g.windowStart > this.windowMs && !(g.lockedUntil !== null && now < g.lockedUntil)) {
      this.global = this.fresh(now);
    }
    return this.global;
  }

  private static lockedMessage(until: number, now: number): string {
    return `Too many failed attempts. Try again in ${Math.ceil((until - now) / 1000)}s.`;
  }

  /** Returns null if allowed, or a human-readable reason string if blocked. */
  check(key: string): string | null {
    const now = this.now();
    const g = this.currentGlobal(now);
    if (g.lockedUntil !== null && now < g.lockedUntil) return LoginRateLimiter.lockedMessage(g.lockedUntil, now);
    const s = this.current(key, now);
    if (s.lockedUntil !== null && now < s.lockedUntil) return LoginRateLimiter.lockedMessage(s.lockedUntil, now);
    return null;
  }

  /** Call after a failed login attempt. */
  recordFailure(key: string): void {
    const now = this.now();
    const s = this.current(key, now);
    s.attempts++;
    if (s.attempts >= this.maxAttempts) s.lockedUntil = now + this.lockoutMs;
    const g = this.currentGlobal(now);
    g.attempts++;
    if (g.attempts >= this.globalMax) g.lockedUntil = now + this.lockoutMs;
    // Bound the map: drop keys whose window and lockout are both over.
    if (this.state.size > 10_000) {
      for (const [k, v] of this.state) {
        if (now - v.windowStart > this.windowMs && !(v.lockedUntil !== null && now < v.lockedUntil)) this.state.delete(k);
      }
    }
  }

  /** Reset a client's state after a successful login (the global count stays). */
  reset(key: string): void {
    this.state.delete(key);
  }
}
