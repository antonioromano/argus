import { Router } from 'express';
import type { AuthService } from '../services/AuthService.js';
import { LoginRateLimiter } from '../services/LoginRateLimiter.js';
import { validatePasswordStrength } from '../services/passwordStrength.js';

const limiter = new LoginRateLimiter();

/** True when the request originated from the local machine (loopback). */
export function isLoopbackRequest(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

/**
 * Decide whether a /set-password request is allowed. Security-critical, so it is
 * a pure function with its own tests.
 *
 * `req.socket.remoteAddress` ALONE is not a trustworthy "is local" signal: an
 * ngrok tunnel (or any reverse proxy) forwards over a loopback connection, so a
 * tunneled request also appears to come from 127.0.0.1. ngrok appends
 * `X-Forwarded-*` headers it cannot suppress, so their presence proves the
 * request was proxied — reject it. And an already-set password may only be
 * changed by a caller proving knowledge of the current one (a valid token);
 * first-time setup is the only unauthenticated path, reachable solely from a
 * local, non-proxied request.
 */
export function canSetPassword(opts: {
  remoteAddress: string | undefined;
  proxied: boolean;
  alreadyEnabled: boolean;
  hasValidToken: boolean;
}): { ok: true } | { ok: false; status: number; error: string } {
  if (!isLoopbackRequest(opts.remoteAddress) || opts.proxied) {
    return { ok: false, status: 403, error: 'Password can only be set from the local machine' };
  }
  if (opts.alreadyEnabled && !opts.hasValidToken) {
    return { ok: false, status: 409, error: 'A password is already set; authenticate to change it' };
  }
  return { ok: true };
}

export function createAuthRoutes(authService: AuthService): Router {
  const router = Router();

  // Loopback-only, non-proxied password setup. Lets a LAN-exposed instance
  // (ARGUS_HOST=0.0.0.0) get a FIRST password without an ngrok tunnel — otherwise
  // the fail-closed gate 503s every protected route, including /api/ngrok/start,
  // and the instance is bricked. Public (skips the token/503 gate) but guarded by
  // canSetPassword(): a tunneled/proxied request is rejected even though it
  // arrives from 127.0.0.1, and an existing password cannot be reset without a
  // valid token.
  router.post('/set-password', (req, res) => {
    const proxied =
      req.headers['x-forwarded-for'] !== undefined ||
      req.headers['x-forwarded-host'] !== undefined ||
      req.headers['forwarded'] !== undefined;
    const auth = req.headers.authorization;
    const presentedToken = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
    const decision = canSetPassword({
      remoteAddress: req.socket.remoteAddress,
      proxied,
      alreadyEnabled: authService.enabled,
      hasValidToken: presentedToken !== null && authService.validateToken(presentedToken),
    });
    if (!decision.ok) {
      res.status(decision.status).json({ error: decision.error });
      return;
    }
    const { password } = req.body ?? {};
    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'A password is required' });
      return;
    }
    const weak = validatePasswordStrength(password);
    if (weak) {
      res.status(400).json({ error: weak });
      return;
    }
    authService.setPassword(password);
    const token = authService.generateToken();
    res.json({ token });
  });

  router.get('/status', (req, res) => {
    const status: { required: boolean; authenticated?: boolean } = {
      required: authService.enabled,
    };

    if (authService.enabled) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        status.authenticated = authService.validateToken(authHeader.slice(7));
      } else {
        status.authenticated = false;
      }
    }

    res.json(status);
  });

  router.post('/login', (req, res) => {
    if (!authService.enabled) {
      res.status(400).json({ error: 'Authentication is not enabled' });
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const blocked = limiter.check(ip);
    if (blocked) {
      res.status(429).json({ error: blocked });
      return;
    }

    const { password } = req.body ?? {};
    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    if (!authService.verifyPassword(password)) {
      limiter.recordFailure(ip);
      res.status(401).json({ error: 'Incorrect password' });
      return;
    }

    limiter.reset(ip);
    const token = authService.generateToken();
    res.json({ token });
  });

  return router;
}
