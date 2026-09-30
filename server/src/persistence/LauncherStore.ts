import { readFile, copyFile } from 'fs/promises';
import type { Launcher } from '@argus/shared';
import { atomicWrite } from '../utils/atomicWrite.js';

const ID_RE = /^[a-z0-9-]{1,40}$/;

function isLauncher(v: unknown): v is Launcher {
  const l = v as Launcher;
  return !!l && typeof l === 'object'
    && typeof l.id === 'string' && ID_RE.test(l.id)
    && typeof l.label === 'string'
    && typeof l.agentCommand === 'string'
    && Array.isArray(l.folderConfigAtSave)
    && !!l.request && typeof l.request.agent === 'string' && typeof l.request.folder === 'string'
    && Array.isArray(l.request.flags);
}

/**
 * Saved deep-link launchers (argus://run/<id>). A file of its own, deliberately
 * not an AppConfig key: PUT /api/config rebuilds config from an allowlist and is
 * reachable remotely (ngrok), so launchers never pass through it. Only the
 * Electron main-process IPC path writes here (LaunchService).
 */
export class LauncherStore {
  constructor(private filePath: string) {}

  async load(): Promise<Launcher[]> {
    try {
      const data = JSON.parse(await readFile(this.filePath, 'utf-8'));
      return Array.isArray(data) ? data.filter(isLauncher) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      console.warn('[LauncherStore] load failed:', err);
      // Unparseable: keep a copy before the next save() overwrites it with [].
      if (err instanceof SyntaxError) {
        await copyFile(this.filePath, `${this.filePath}.bak`).catch((e) => console.warn('[LauncherStore] backup failed:', e));
      }
      return [];
    }
  }

  async save(list: Launcher[]): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(list, null, 2));
  }
}
