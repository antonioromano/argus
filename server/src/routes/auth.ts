import { Router } from 'express';
import type { AuthService } from '../services/AuthService.js';
import { LoginRateLimiter } from '../services/LoginRateLimiter.js';
import { validatePasswordStrength } from '../services/passwordStrength.js';

const limiter = new LoginRateLimiter();

/** True when the request originated from the local machine (loopback). */
function isLoopbackRequest(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

export function createAuthRoutes(authService: AuthService): Router {
  const router = Router();

  // Loopback-only password setup. Lets a LAN-exposed instance (ARGUS_HOST=0.0.0.0)
  // get a password without first starting an ngrok tunnel — otherwise the fail-
  // closed gate 503s every protected route, including /api/ngrok/start, and the
  // instance is bricked. Public (skips the token/503 gate) but the loopback check
  // means only a local process can reach it; a remote attacker is rejected.
  router.post('/set-password', (req, res) => {
    if (!isLoopbackRequest(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'Password can only be set from the local machine' });
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
