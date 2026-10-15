import { readFile, copyFile } from 'fs/promises';
import type { SessionChain } from '@argus/shared';
import { atomicWrite } from '../utils/atomicWrite.js';

const TRIGGERS = new Set(['idle', 'waiting', 'done']);
const MODES = new Set(['once', 'repeat']);

function isChain(v: unknown): v is SessionChain {
  const c = v as SessionChain;
  return !!c && typeof c === 'object'
    && typeof c.id === 'string' && !!c.id
    && typeof c.sourceId === 'string' && !!c.sourceId
    && typeof c.targetId === 'string' && !!c.targetId
    && c.sourceId !== c.targetId
    && TRIGGERS.has(c.trigger)
    && MODES.has(c.mode)
    && typeof c.prompt === 'string' && !!c.prompt
    && typeof c.armed === 'boolean';
}

/**
 * Beta F13 session chains (server/data/chains.json). A file of its own, never
 * an AppConfig key: a chain types a prompt into an agent, and PUT /api/config
 * must never be a way to write one. Malformed entries are dropped on load.
 */
export class ChainStore {
  constructor(private filePath: string) {}

  async load(): Promise<SessionChain[]> {
    try {
      const data = JSON.parse(await readFile(this.filePath, 'utf-8'));
      return Array.isArray(data)
        ? data.filter(isChain).map((c) => ({ ...c, fireCount: Number.isInteger(c.fireCount) ? c.fireCount : 0 }))
        : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      console.warn('[ChainStore] load failed:', err);
      // Unparseable: keep a copy before the next save() overwrites it.
      if (err instanceof SyntaxError) {
        await copyFile(this.filePath, `${this.filePath}.bak`).catch((e) => console.warn('[ChainStore] backup failed:', e));
      }
      return [];
    }
  }

  async save(list: SessionChain[]): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(list, null, 2));
  }
}
