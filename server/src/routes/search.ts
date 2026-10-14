import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getRipgrepPath } from '../utils/ripgrep.js';
import { searchSessions, type SearchTarget } from '../services/search/crossSessionSearch.js';

export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 200;
export const SEARCH_LIMIT_DEFAULT = 100;
export const SEARCH_LIMIT_MAX = 500;

export interface SearchRouteDeps {
  targets: () => SearchTarget[];
  /** Defaults to the bundled ripgrep; null skips transcripts. */
  rgPath?: () => string | null;
  budgetMs?: number;
}

/**
 * F9 cross-session search: `GET /api/search?q=&limit=`. Mounted behind the
 * bearer-auth middleware. Takes no path from the request — transcripts are
 * only the validated files each session's usage meter already tracks — so
 * pathScope does not apply. The query is a literal, never a regex.
 */
export function createSearchRoutes(deps: SearchRouteDeps): Router {
  const router = Router();
  router.get('/', asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < SEARCH_QUERY_MIN || q.length > SEARCH_QUERY_MAX || q.includes('\0') || /[\r\n]/.test(q)) {
      res.status(400).json({ error: `q must be ${SEARCH_QUERY_MIN}–${SEARCH_QUERY_MAX} characters on one line` });
      return;
    }
    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, SEARCH_LIMIT_MAX) : SEARCH_LIMIT_DEFAULT;
    const rgPath = (deps.rgPath ?? getRipgrepPath)();
    res.json(await searchSessions(deps.targets(), q, { limit, rgPath, budgetMs: deps.budgetMs }));
  }));
  return router;
}
