import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { WindowRegistry } from '../services/WindowRegistry.js';

/** Callbacks into the Electron host (open/close/focus BrowserWindows).
 *  All optional — the plain-node `dev:web` server runs without a host. */
export interface WindowHostHooks {
  onCreate?: (id: string) => void;
  onClose?: (id: string) => void;
  onFocus?: (id: string) => void;
}

/**
 * Window registry CRUD. Mounted behind the bearer-auth middleware like every
 * other API route. No filesystem paths involved, so pathScope does not apply.
 */
export function createWindowRoutes(
  registry: WindowRegistry,
  listSessionIds: () => string[],
  hooks: WindowHostHooks,
): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(registry.getState());
  });

  router.post('/', asyncHandler(async (req, res) => {
    const sessionId = (req.body ?? {}).sessionId as string | undefined;
    if (sessionId !== undefined && !listSessionIds().includes(sessionId)) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }
    const win = await registry.createWindow(sessionId);
    hooks.onCreate?.(win.id);
    res.status(201).json(win);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!registry.getState().windows.some((w) => w.id === id)) {
      res.status(404).json({ error: 'Window not found' });
      return;
    }
    const ok = await registry.deleteWindow(id);
    if (!ok) {
      res.status(400).json({ error: 'The main window cannot be deleted' });
      return;
    }
    hooks.onClose?.(id);
    res.json({ ok: true });
  }));

  router.put('/assign', asyncHandler(async (req, res) => {
    const { sessionId, windowId } = (req.body ?? {}) as { sessionId?: string; windowId?: string };
    if (typeof sessionId !== 'string' || typeof windowId !== 'string') {
      res.status(400).json({ error: 'sessionId and windowId are required' });
      return;
    }
    if (!listSessionIds().includes(sessionId)) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }
    const ok = await registry.assign(sessionId, windowId);
    if (!ok) {
      res.status(404).json({ error: 'Window not found' });
      return;
    }
    res.json(registry.getState());
  }));

  router.post('/:id/merge-all', asyncHandler(async (req, res) => {
    const removed = await registry.mergeAll(req.params.id, listSessionIds());
    if (removed === null) {
      res.status(404).json({ error: 'Window not found' });
      return;
    }
    for (const id of removed) hooks.onClose?.(id);
    res.json(registry.getState());
  }));

  router.put('/:id/label', asyncHandler(async (req, res) => {
    const raw = (req.body ?? {}).label;
    const label = typeof raw === 'string' ? raw.trim() : '';
    if (label.length < 1 || label.length > 60) {
      res.status(400).json({ error: 'label must be a non-empty string of at most 60 characters' });
      return;
    }
    const ok = await registry.rename(req.params.id, label);
    if (!ok) {
      res.status(404).json({ error: 'Window not found' });
      return;
    }
    res.json(registry.getState());
  }));

  router.post('/:id/focus', (req, res) => {
    const { id } = req.params;
    if (!registry.getState().windows.some((w) => w.id === id)) {
      res.status(404).json({ error: 'Window not found' });
      return;
    }
    hooks.onFocus?.(id);
    res.json({ ok: true });
  });

  return router;
}
