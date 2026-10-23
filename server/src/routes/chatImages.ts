import express, { Router } from 'express';
import { randomUUID } from 'crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Chat view (B1): an image pasted from the clipboard has no file behind it, so
 * Claude Code can't be given its path. The client uploads it here; it is saved
 * to a private temp dir and the path comes back, to be sent like an attached
 * file. Mounted on /api/sessions, behind the auth middleware.
 */

export interface ChatImageRouteDeps {
  /** True for a live Claude session (the only kind with a Chat view). */
  isChatSession: (sessionId: string) => boolean;
  /** Where images are written (default: `<tmpdir>/argus-chat-images`). */
  dir?: string;
  /** Files older than this are removed on the next upload. */
  maxAgeMs?: number;
}

export const MAX_CHAT_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Accepted types and the magic bytes each must start with. */
const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/gif': { ext: 'gif', magic: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

export function defaultChatImageDir(): string {
  return path.join(os.tmpdir(), 'argus-chat-images');
}

async function sweep(dir: string, maxAgeMs: number): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const p = path.join(dir, name);
    try {
      if ((await stat(p)).mtimeMs < cutoff) await unlink(p);
    } catch {
      /* raced with another sweep */
    }
  }
}

/** `POST /api/sessions/:id/chat-image` (raw image body) → `{ path }`. */
export function createChatImageRoutes(deps: ChatImageRouteDeps): Router {
  const router = Router();
  const dir = deps.dir ?? defaultChatImageDir();
  const maxAgeMs = deps.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const raw = express.raw({ type: Object.keys(IMAGE_TYPES), limit: MAX_CHAT_IMAGE_BYTES });

  router.post('/:id/chat-image', raw, async (req, res) => {
    if (!deps.isChatSession(String(req.params.id))) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const type = IMAGE_TYPES[String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()];
    const body = req.body;
    if (!type || !Buffer.isBuffer(body) || body.length === 0 || !type.magic(body)) {
      res.status(400).json({ error: 'Expected a PNG, JPEG, GIF or WebP image' });
      return;
    }
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await sweep(dir, maxAgeMs);
      const file = path.join(dir, `${randomUUID()}.${type.ext}`);
      await writeFile(file, body, { mode: 0o600 });
      res.json({ path: file });
    } catch (err) {
      console.error('[chat-image] save failed:', err);
      res.status(500).json({ error: 'Could not save the image' });
    }
  });
  return router;
}
