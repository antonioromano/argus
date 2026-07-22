import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, chmodSync } from 'fs';

/**
 * Per-session ingestion token = HMAC-SHA256(serverSecret, sessionId), hex.
 * Deterministic, so a tmux survivor keeps a valid token across an app restart
 * without persisting any per-session state (R6). The secret never leaves the
 * box and never appears in logs or the diagnostics dump.
 */
export function computeSignalToken(secret: string, sessionId: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('hex');
}

/** Constant-time token check. False on any length/format mismatch. */
export function verifySignalToken(secret: string, sessionId: string, token: string): boolean {
  const expected = computeSignalToken(secret, sessionId);
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Load the server signal secret, generating it on first run. Stored in a
 * server-only file (mode 600) — NOT in AppConfig, which is served to clients.
 * Synchronous: called once at startup before routes mount.
 */
export function getOrCreateSignalSecret(filePath: string): string {
  try {
    const existing = readFileSync(filePath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // ENOENT / unreadable — generate a fresh secret below.
  }
  const secret = randomBytes(32).toString('hex');
  writeFileSync(filePath, secret, { mode: 0o600 });
  try {
    chmodSync(filePath, 0o600); // ensure 600 even if umask widened the create mode
  } catch {
    // best-effort hardening
  }
  return secret;
}
