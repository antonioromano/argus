import type { Request, Response, NextFunction } from 'express';
import { authVerdict, type AuthService } from '../services/AuthService.js';
import { isExposedRequest } from './exposure.js';

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
    // Lowercased so the gate can never disagree with routing about what is an
    // API path (index.ts also makes routing case-sensitive).
    const p = req.path.toLowerCase();
    if (!p.startsWith('/api/') || PUBLIC_PATHS.includes(p)) {
      next();
      return;
    }

    // A request through a tunnel Argus did not start (manual ngrok,
    // cloudflared, tailscale) is exposed even while authService.exposed is false.
    const exposedRequest = isExposedRequest(req.headers, req.socket.remoteAddress);
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    switch (authVerdict(authService, token, exposedRequest)) {
      case 'ok':
        break;
      case 'no-password':
        // Fail-closed: reachable off-loopback but no password set yet.
        res.status(503).json({ error: 'Server is network-exposed but has no password set. Start a tunnel via /api/ngrok/start to set one.' });
        return;
      case 'missing-token':
        res.status(401).json({ error: 'Authentication required' });
        return;
      case 'invalid-token':
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
    }

    next();
  };
}
