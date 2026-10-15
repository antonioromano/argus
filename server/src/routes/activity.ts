import { Router } from 'express';
import type { ActivityEvent, ActivityListResponse } from '@argus/shared';

/** Beta F6 wiring. `isEnabled` false → the route 404s. */
export interface ActivityRouteDeps {
  isEnabled: () => boolean;
  /** Oldest-first entries; undefined for an unknown session. */
  getActivity: (sessionId: string) => ActivityEvent[] | undefined;
}

/** `GET /api/sessions/:id/activity` — mounted on /api/sessions, behind the auth middleware. */
export function createActivityRoutes(deps: ActivityRouteDeps): Router {
  const router = Router();
  router.get('/:id/activity', (req, res) => {
    if (!deps.isEnabled()) {
      res.status(404).json({ error: 'The activity timeline is a beta feature that is switched off.' });
      return;
    }
    const events = deps.getActivity(String(req.params.id));
    if (!events) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const out: ActivityListResponse = { events };
    res.json(out);
  });
  return router;
}
