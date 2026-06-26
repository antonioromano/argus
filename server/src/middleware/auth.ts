import type { Request, Response, NextFunction } from 'express';
import type { AuthService } from '../services/AuthService.js';

const PUBLIC_PATHS = [
  '/api/auth/status',
  '/api/auth/login',
  // Loopback-only at the handler level; public here so a LAN-exposed instance
  // with no password yet (503 fail-closed on everything else) can still set one.
  '/api/auth/set-password',
  '/api/ngrok/status',
  '/api/health',
];

export function createAuthMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path.startsWith('/api/') || PUBLIC_PATHS.includes(req.path)) {
      next();
      return;
    }

    // Fail-closed: server is reachable off-loopback but no password set yet.
    // Block all protected API calls until the operator sets a password.
    if (authService.exposed && !authService.enabled) {
      res.status(503).json({ error: 'Server is network-exposed but has no password set. Start a tunnel via /api/ngrok/start to set one.' });
      return;
    }

    if (!authService.enforced) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const token = authHeader.slice(7);
    if (!authService.validateToken(token)) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    next();
  };
}
