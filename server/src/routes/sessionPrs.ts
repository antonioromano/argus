import { Router } from 'express';
import type { SessionManager } from '../services/SessionManager.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isGithubPrUrl } from '../services/usage/TranscriptTailer.js';

/**
 * B3: the Session Inspector's GitHub card — every PR of one session with its
 * live status (`SessionPrsResponse`). Read-only, polled only while the card is
 * open. `gh` runs in the session's work root, resolved through pathScope by
 * SessionManager.listSessionPrs; the PR URLs come from the session's own
 * transcript and are validated there, never from the request.
 * B4 adds the diff of one of those PRs.
 */
export function createSessionPrRoutes(manager: Pick<SessionManager, 'listSessionPrs' | 'sessionPrDiff'>): Router {
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

  /**
   * B4: one PR's changed files and diff (`gh pr diff`). `url` only selects an
   * entry of the session's own PR list; anything else is a 404.
   */
  router.get('/sessions/:id/pr-diff', asyncHandler(async (req, res) => {
    const url = req.query.url;
    if (!isGithubPrUrl(url)) {
      res.status(400).json({ error: 'url must be a github.com pull request URL' });
      return;
    }
    const result = await manager.sessionPrDiff(req.params.id, url);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.json(result.diff);
  }));

  return router;
}
