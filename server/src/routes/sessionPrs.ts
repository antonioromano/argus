import { Router } from 'express';
import type { SessionPrReadyResponse } from '@argus/shared';
import type { SessionManager } from '../services/SessionManager.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isGithubPrUrl } from '../services/usage/TranscriptTailer.js';

/**
 * B3: the Session Inspector's GitHub card — every PR of one session with its
 * live status (`SessionPrsResponse`). Read-only, polled only while the card is
 * open. `gh` runs in the session's work root, resolved through pathScope by
 * SessionManager.listSessionPrs; the PR URLs come from the session's own
 * transcript and are validated there, never from the request.
 * B4 adds the diff of one of those PRs; C3 the one write, Mark ready.
 */
export function createSessionPrRoutes(manager: Pick<SessionManager, 'listSessionPrs' | 'sessionPrDiff' | 'setSessionPrReady'>): Router {
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

  /**
   * C3: `gh pr ready` / `gh pr ready --undo` on one of the session's PRs —
   * the only route that writes to GitHub. `url` only selects an entry of the
   * session's own PR list, exactly like the diff; anything else is a 404.
   */
  router.post('/sessions/:id/prs/ready', asyncHandler(async (req, res) => {
    const { url, ready } = (req.body ?? {}) as { url?: unknown; ready?: unknown };
    if (!isGithubPrUrl(url)) {
      res.status(400).json({ error: 'url must be a github.com pull request URL' });
      return;
    }
    if (typeof ready !== 'boolean') {
      res.status(400).json({ error: 'ready must be a boolean' });
      return;
    }
    const result = await manager.setSessionPrReady(req.params.id, url, ready);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    const body: SessionPrReadyResponse = { pr: result.pr };
    res.json(body);
  }));

  return router;
}
