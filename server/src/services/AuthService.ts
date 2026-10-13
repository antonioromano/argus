import crypto from 'crypto';
import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type AuthVerdict = 'ok' | 'no-password' | 'missing-token' | 'invalid-token';

/**
 * The one auth decision, shared by the HTTP middleware and the socket gate (both
 * at handshake and on every re-check). `exposedRequest` is the per-request
 * signal from middleware/exposure.ts; it widens enforcement to tunnels Argus did
 * not start itself.
 */
export function authVerdict(
  auth: Pick<AuthService, 'exposed' | 'enabled' | 'enforced' | 'validateToken'>,
  token: string | null | undefined,
  exposedRequest: boolean,
): AuthVerdict {
  const exposed = auth.exposed || exposedRequest;
  // Fail-closed: reachable off-loopback but no password to check against.
  if (exposed && !auth.enabled) return 'no-password';
  if (!auth.enforced && !exposed) return 'ok';
  if (!token) return 'missing-token';
  return auth.validateToken(token) ? 'ok' : 'invalid-token';
}

export class AuthService {
  private passwordHash: string | null = null; // "salt:key" (hex)
  private validTokens = new Map<string, number>(); // token -> createdAt ms
  private io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
  private _exposed = false;
  private enforcementListeners = new Set<() => void>();

  setIo(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
    this.io = io;
  }

  get enabled(): boolean {
    return this.passwordHash !== null;
  }

  get exposed(): boolean {
    return this._exposed;
  }

  /** True when a bearer token is required for API access. */
  get enforced(): boolean {
    return this._exposed || this.enabled;
  }

  /**
   * Called whenever the rules a live connection was admitted under may have
   * tightened: exposure turned on, the password changed (old tokens revoked), or
   * auth was cleared while still exposed. The socket layer uses it to drop
   * connections that no longer hold a valid token — the handshake check alone
   * left sockets admitted before the change connected indefinitely.
   */
  onEnforcementChange(cb: () => void): () => void {
    this.enforcementListeners.add(cb);
    return () => this.enforcementListeners.delete(cb);
  }

  private notifyEnforcementChange(): void {
    for (const cb of this.enforcementListeners) {
      try { cb(); } catch (err) { console.error('[auth] enforcement listener failed:', err); }
    }
  }

  setExposed(value: boolean): void {
    if (this._exposed === value) return;
    this._exposed = value;
    this.notifyEnforcementChange();
  }

  /**
   * Set or change the password. Every previously issued token is revoked: a
   * token proves knowledge of the password it was issued under, so after a
   * change (e.g. a leaked tunnel password being rotated) it must stop working.
   */
  setPassword(password: string): void {
    const salt = crypto.randomBytes(16).toString('hex');
    const key = crypto.scryptSync(password, salt, 64).toString('hex');
    this.passwordHash = `${salt}:${key}`;
    this.validTokens.clear();
    this.io?.emit('auth:required', { required: true });
    this.notifyEnforcementChange();
  }

  verifyPassword(password: string): boolean {
    if (!this.passwordHash) return false;
    const [salt, storedKey] = this.passwordHash.split(':');
    try {
      const key = crypto.scryptSync(password, salt, 64).toString('hex');
      return crypto.timingSafeEqual(
        Buffer.from(key, 'hex'),
        Buffer.from(storedKey, 'hex'),
      );
    } catch {
      return false;
    }
  }

  generateToken(): string {
    this.sweepExpiredTokens();
    const token = crypto.randomUUID();
    this.validTokens.set(token, Date.now());
    return token;
  }

  /** Drop expired tokens. Called on issue so the Map can't grow without bound
   *  from clients that authenticate once and never trigger an expiry check. */
  private sweepExpiredTokens(): void {
    const now = Date.now();
    for (const [token, createdAt] of this.validTokens) {
      if (now - createdAt > TOKEN_TTL_MS) this.validTokens.delete(token);
    }
  }

  validateToken(token: string): boolean {
    const createdAt = this.validTokens.get(token);
    if (createdAt === undefined) return false;
    if (Date.now() - createdAt > TOKEN_TTL_MS) {
      this.validTokens.delete(token);
      return false;
    }
    return true;
  }

  clearAuth(): void {
    this.passwordHash = null;
    this.validTokens.clear();
    this.io?.emit('auth:required', { required: false });
    this.notifyEnforcementChange();
  }
}
