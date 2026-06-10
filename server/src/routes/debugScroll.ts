import { Router } from 'express';
import express from 'express';
import fs from 'fs';
import path from 'path';

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export function createDebugScrollRoute(dataDir: string): Router {
  const router = Router();
  router.use(express.text({ type: '*/*', limit: '1mb' }));
  router.post('/', async (req, res) => {
    const logPath = path.join(dataDir, 'scroll-debug.log');
    try {
      try {
        const stat = await fs.promises.stat(logPath);
        if (stat.size > MAX_LOG_BYTES) await fs.promises.truncate(logPath, 0);
      } catch { /* file doesn't exist yet */ }
      await fs.promises.appendFile(
        logPath,
        `\n===== ${new Date().toISOString()} =====\n${typeof req.body === 'string' ? req.body : ''}\n`,
      );
    } catch { /* best-effort */ }
    res.status(204).end();
  });
  return router;
}
