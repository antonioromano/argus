import crypto from 'crypto';
import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@argus/shared';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class AuthService {
  private passwordHash: string | null = null; // "salt:key" (hex)
  private validTokens = new Map<string, number>(); // token -> createdAt ms
  private io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

  setIo(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
    this.io = io;
  }

  get enabled(): boolean {
    return this.passwordHash !== null;
  }

  setPassword(password: string): void {
    const salt = crypto.randomBytes(16).toString('hex');
    const key = crypto.scryptSync(password, salt, 64).toString('hex');
    this.passwordHash = `${salt}:${key}`;
    this.io?.emit('auth:required', { required: true });
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
    const token = crypto.randomUUID();
    this.validTokens.set(token, Date.now());
    return token;
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
  }
}
