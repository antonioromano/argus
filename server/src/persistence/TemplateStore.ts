import { readFile, copyFile } from 'fs/promises';
import type { SessionTemplate } from '@argus/shared';
import { atomicWrite } from '../utils/atomicWrite.js';

function isTemplate(v: unknown): v is SessionTemplate {
  const t = v as SessionTemplate;
  return !!t && typeof t === 'object'
    && typeof t.id === 'string' && !!t.id
    && typeof t.name === 'string'
    && Array.isArray(t.specs)
    && t.specs.every((s) => !!s && typeof s === 'object' && typeof s.agent === 'string' && typeof s.folder === 'string');
}

/**
 * Beta F10 multi-session templates (server/data/templates.json). A file of its
 * own, deliberately not an AppConfig key: templates carry folders and prompts
 * that start agents, and PUT /api/config must never be a way to write those.
 * Malformed entries are dropped on load; every spec is validated again on launch.
 */
export class TemplateStore {
  constructor(private filePath: string) {}

  async load(): Promise<SessionTemplate[]> {
    try {
      const data = JSON.parse(await readFile(this.filePath, 'utf-8'));
      return Array.isArray(data) ? data.filter(isTemplate) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      console.warn('[TemplateStore] load failed:', err);
      // Unparseable: keep a copy before the next save() overwrites it.
      if (err instanceof SyntaxError) {
        await copyFile(this.filePath, `${this.filePath}.bak`).catch((e) => console.warn('[TemplateStore] backup failed:', e));
      }
      return [];
    }
  }

  async save(list: SessionTemplate[]): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(list, null, 2));
  }
}
