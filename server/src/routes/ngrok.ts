import { Router } from 'express';
import type { NgrokService } from '../services/NgrokService.js';
import type { AuthService } from '../services/AuthService.js';

export function createNgrokRoutes(ngrokService: NgrokService, authService: AuthService): Router {
  const router = Router();
  const serverPort = Number(process.env.ARGUS_PORT || process.env.PORT) || 5401;
  // In production the server serves both API and client on serverPort.
  // In dev the client runs on its own port (Vite default 5402) and proxies /api → serverPort.
  // Forward ngrok to whichever port actually serves the UI to a browser.
  const isProduction = process.env.NODE_ENV === 'production';
  const defaultTunnelPort = isProduction
    ? serverPort
    : Number(process.env.CLIENT_PORT) || 5402;

  router.get('/status', (_req, res) => {
    res.json({ ...ngrokService.getStatus(), authRequired: authService.enabled });
  });

  router.post('/start', async (req, res) => {
    if (!ngrokService.installed) {
      res.status(400).json({ error: 'ngrok is not installed' });
      return;
    }

    const { password } = req.body ?? {};
    if (!password || typeof password !== 'string' || password.trim().length < 4) {
      res.status(400).json({ error: 'A password of at least 4 characters is required to start the tunnel' });
      return;
    }

    try {
      const port = typeof req.body?.port === 'number' ? req.body.port : defaultTunnelPort;
      const publicUrl = await ngrokService.start(port);
      authService.setPassword(password);
      const token = authService.generateToken();
      res.json({ publicUrl, token });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start ngrok';
      res.status(500).json({ error: message });
    }
  });

  router.post('/stop', async (_req, res) => {
    try {
      await ngrokService.stop();
      res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop ngrok';
      res.status(500).json({ error: message });
    }
  });

  router.post('/recheck', async (_req, res) => {
    await ngrokService.recheckInstallation();
    res.json({ ...ngrokService.getStatus(), authRequired: authService.enabled });
  });

  return router;
}
