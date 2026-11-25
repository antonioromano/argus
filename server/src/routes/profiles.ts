import { Router } from 'express';
import type { ProfilesResponse, ProfilesState } from '@argus/shared';
import { asyncHandler } from '../middleware/errorHandler.js';
import { sanitizeProfilesState } from '../services/profiles.js';

export interface ProfileDeps {
  store: { load(): Promise<ProfilesState>; save(state: ProfilesState): Promise<void> };
  /** The OS account's full name, to prefill a first profile. */
  suggestedName: () => Promise<string>;
  /** profiles.json changed — tell every window to refetch. */
  onChanged?: () => void;
}

/**
 * `/api/profiles` — the whole profile state is read and replaced as one
 * document (it is small, and every edit is a client-side read-modify-write of
 * it). Mounted behind the auth middleware.
 */
export function createProfileRoutes(deps: ProfileDeps): Router {
  const router = Router();
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  router.get('/', asyncHandler(async (_req, res) => {
    const [state, suggestedName] = await Promise.all([deps.store.load(), deps.suggestedName().catch(() => '')]);
    const body: ProfilesResponse = { ...state, suggestedName };
    res.json(body);
  }));

  router.put('/', asyncHandler(async (req, res) => {
    const next = sanitizeProfilesState(req.body);
    if (!next) {
      res.status(400).json({ error: 'Expected { activeId, profiles, prompt }' });
      return;
    }
    await serial(() => deps.store.save(next));
    deps.onChanged?.();
    res.json(next);
  }));

  return router;
}
