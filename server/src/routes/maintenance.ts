import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { OrphanJanitor } from '../services/OrphanJanitor.js';

/**
 * F16 maintenance routes: list and kill orphan/duplicate agents. Mounted behind
 * the bearer-auth middleware like every other /api route. No filesystem paths
 * are taken from the request, so pathScope does not apply; the kill route only
 * signals pids that a fresh scan still classifies as orphans.
 */
export function createMaintenanceRoutes(janitor: Pick<OrphanJanitor, 'list' | 'kill'>): Router {
  const router = Router();
  let startupNotified = false;

  // `?startup=1` is the client's launch check: `notify` is true only the first
  // time per server process, so the toast shows once per launch across windows
  // and reloads.
  router.get('/orphans', asyncHandler(async (req, res) => {
    const report = await janitor.list();
    if (req.query.startup === '1') {
      report.notify = !startupNotified && report.daemons.length > 0;
      startupNotified = true;
    }
    res.json(report);
  }));

  router.post('/orphans/kill', asyncHandler(async (req, res) => {
    const pids = (req.body ?? {}).pids;
    if (!Array.isArray(pids) || pids.length === 0 || pids.length > 500 || !pids.every((p) => Number.isInteger(p) && p > 1)) {
      res.status(400).json({ error: 'pids must be a non-empty array of process ids' });
      return;
    }
    res.json(await janitor.kill(pids));
  }));

  return router;
}
