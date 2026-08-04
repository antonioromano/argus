import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isKeepAwakeDuration } from '../services/KeepAwakeService.js';
import type { KeepAwakeService } from '../services/KeepAwakeService.js';

export const KEEP_AWAKE_BAD_DURATION =
  'durationMs must be null (indefinite) or one of: 5, 15, 30, 60, 120, 240 minutes.';

/**
 * Manual keep-awake window (the toolbar CTA).
 *
 * Mounted behind the bearer-auth middleware, so a remote/mobile client cannot
 * arm the Mac's sleep blocker unauthenticated. No filesystem paths are involved,
 * so pathScope does not apply here.
 */
export function createKeepAwakeRoutes(keepAwake: KeepAwakeService): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(keepAwake.status);
  });

  router.post('/', asyncHandler(async (req, res) => {
    const durationMs = (req.body ?? {}).durationMs;
    if (!isKeepAwakeDuration(durationMs)) {
      res.status(400).json({ error: KEEP_AWAKE_BAD_DURATION });
      return;
    }
    res.json(await keepAwake.arm(durationMs));
  }));

  router.delete('/', asyncHandler(async (_req, res) => {
    res.json(await keepAwake.disarm());
  }));

  return router;
}
