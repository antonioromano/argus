import { readFile } from 'fs/promises';
import path from 'path';
import { atomicWrite } from '../utils/atomicWrite.js';

export interface PersistedSession {
  id: string;
  name: string;
  folderPath: string;
  createdAt: string;
  agentType: string;
  flags: string[];
}

export class SessionStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async save(sessions: PersistedSession[]): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(sessions, null, 2));
  }

  async load(): Promise<PersistedSession[]> {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      // Backfill agentType for sessions saved before multi-agent support
      // Backfill flags for sessions saved before CLI flags support
      return parsed.map((s: PersistedSession) => ({
        ...s,
        agentType: s.agentType || 'claude',
        flags: s.flags || [],
      }));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[SessionStore] Failed to load sessions:', err);
      }
      return [];
    }
  }
}
