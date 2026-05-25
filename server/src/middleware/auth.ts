import type { Request, Response, NextFunction } from 'express';
import type { AuthService } from '../services/AuthService.js';

const PUBLIC_PATHS = [
  '/api/auth/status',
  '/api/auth/login',
  '/api/ngrok/status',
  '/api/health',
];

export function createAuthMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!authService.enabled) {
      next();
      return;
    }

    if (PUBLIC_PATHS.includes(req.path)) {
      next();
      return;
    }

    if (!req.path.startsWith('/api/')) {
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
