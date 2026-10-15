import { Router } from 'express';
import type { ChainAuditResponse, ChainListResponse } from '@argus/shared';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { ChainEngine } from '../services/chains/ChainEngine.js';

/** Beta F13 wiring. `isEnabled` false → every route 404s. */
export interface ChainRouteDeps {
  isEnabled: () => boolean;
  engine: Pick<ChainEngine, 'ready' | 'list' | 'audit' | 'create' | 'remove' | 'setArmed'>;
}

/** Chain ids are server-minted UUIDs; anything else is a 404 without a lookup. */
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/**
 * `/api/chains` — list, create, delete, arm/disarm, and the recent-fires audit.
 * Mounted behind the auth middleware; every rule (A ≠ B, live sessions, agent
 * target, prompt cap, repeat-cycle refusal) is enforced by the engine.
 */
export function createChainRoutes(deps: ChainRouteDeps): Router {
  const router = Router();

  router.use(asyncHandler(async (_req, res, next) => {
    if (!deps.isEnabled()) {
      res.status(404).json({ error: 'Session chains are a beta feature that is switched off.' });
      return;
    }
    await deps.engine.ready();
    next();
  }));

  router.get('/', (_req, res) => {
    const body: ChainListResponse = { chains: deps.engine.list() };
    res.json(body);
  });

  router.get('/audit', (_req, res) => {
    const body: ChainAuditResponse = { fires: deps.engine.audit() };
    res.json(body);
  });

  router.post('/', (req, res) => {
    const r = deps.engine.create(req.body);
    if (!r.ok) {
      res.status(400).json({ error: r.error });
      return;
    }
    res.status(201).json(r.chain);
  });

  router.patch('/:id', (req, res) => {
    const armed = (req.body as { armed?: unknown } | undefined)?.armed;
    if (typeof armed !== 'boolean') {
      res.status(400).json({ error: 'armed must be true or false' });
      return;
    }
    const chain = ID_RE.test(req.params.id) ? deps.engine.setArmed(req.params.id, armed) : undefined;
    if (!chain) {
      res.status(404).json({ error: 'Chain not found' });
      return;
    }
    res.json(chain);
  });

  router.delete('/:id', (req, res) => {
    if (!ID_RE.test(req.params.id) || !deps.engine.remove(req.params.id)) {
      res.status(404).json({ error: 'Chain not found' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
