import { Router } from 'express';
import type { AuthService } from '../services/AuthService.js';

export function createAuthRoutes(authService: AuthService): Router {
  const router = Router();

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

    const { password } = req.body ?? {};
    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'Password is required' });
      return;
    }

    if (!authService.verifyPassword(password)) {
      res.status(401).json({ error: 'Incorrect password' });
      return;
    }

    const token = authService.generateToken();
    res.json({ token });
  });

  return router;
}
