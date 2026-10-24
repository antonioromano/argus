import { Router } from 'express';
import type { SessionManager } from '../services/SessionManager.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * B3: the Session Inspector's GitHub card — every PR of one session with its
 * live status (`SessionPrsResponse`). Read-only, polled only while the card is
 * open. `gh` runs in the session's work root, resolved through pathScope by
 * SessionManager.listSessionPrs; the PR URLs come from the session's own
 * transcript and are validated there, never from the request.
 */
export function createSessionPrRoutes(manager: Pick<SessionManager, 'listSessionPrs'>): Router {
  const router = Router();

  router.get('/sessions/:id/prs', asyncHandler(async (req, res) => {
    const result = await manager.listSessionPrs(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.json(result);
  }));

  return router;
}
