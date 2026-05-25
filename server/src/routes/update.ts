import { Router } from 'express';
import type { Request, Response } from 'express';
import type { UpdateService } from '../services/UpdateService.js';

export function createUpdateRoutes(updateService: UpdateService): Router {
  const router = Router();

  // Triggers a remote version check (subject to 60s cooldown), then returns status
  router.get('/check', async (_req: Request, res: Response) => {
    await updateService.checkForUpdate();
    res.json(updateService.getStatus());
  });

  // Applies the update: guards dirty tree, runs git pull, exits process
  router.post('/apply', async (req: Request, res: Response) => {
    const { force } = req.body as { force?: boolean };
    const result = await updateService.applyUpdate(force);
    if (!result.success) {
      if (result.requiresConfirmation) {
        res.json({ success: false, warning: result.warning, requiresConfirmation: true });
        return;
      }
      const status = result.error === 'Update already in progress' ? 409 : 400;
      res.status(status).json({ error: result.error });
      return;
    }
    res.json({ success: true });
  });

  return router;
}
