import { Router } from 'express';
import type { NgrokService } from '../services/NgrokService.js';
import type { AuthService } from '../services/AuthService.js';
import { validatePasswordStrength } from '../services/passwordStrength.js';
import type { ApiErrorBody } from '@argus/shared';
import { sendError } from '../errors/ArgusError.js';

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
      res.status(400).json({ error: 'ngrok is not installed', code: 'NGROK_NOT_INSTALLED' } satisfies ApiErrorBody);
      return;
    }

    const { password } = req.body ?? {};
    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'A password is required to start the tunnel' });
      return;
    }
    const weak = validatePasswordStrength(password);
    if (weak) {
      res.status(400).json({ error: weak });
      return;
    }

    // Password FIRST, tunnel second. The old order spawned ngrok and only then
    // set the password, so for the ~1s it took ngrok to come up the public URL
    // served an unauthenticated API — and any socket that connected in that
    // window kept its session. Setting it first also revokes old tokens and
    // drops sockets that hold none (AuthService.onEnforcementChange).
    const hadPassword = authService.enabled;
    authService.setPassword(password);
    const token = authService.generateToken();
    try {
      const port = typeof req.body?.port === 'number' ? req.body.port : defaultTunnelPort;
      const publicUrl = await ngrokService.start(port);
      res.json({ publicUrl, token });
    } catch (err) {
      // No tunnel came up: don't leave a password the user never had before.
      if (!hadPassword && !ngrokService.getStatus().publicUrl) authService.clearAuth();
      sendError(res, err ?? new Error('Failed to start ngrok'), { tool: 'ngrok' });
    }
  });

  router.post('/stop', async (_req, res) => {
    try {
      await ngrokService.stop();
      res.status(204).send();
    } catch (err) {
      sendError(res, err ?? new Error('Failed to stop ngrok'), { tool: 'ngrok' });
    }
  });

  router.post('/recheck', async (_req, res) => {
    await ngrokService.recheckInstallation();
    res.json({ ...ngrokService.getStatus(), authRequired: authService.enabled });
  });

  return router;
}
