import { readFile } from 'fs/promises';
import type { SessionGroup } from '@argus/shared';
import { atomicWrite } from '../utils/atomicWrite.js';

export class GroupStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async save(groups: SessionGroup[]): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(groups, null, 2));
  }

  async load(): Promise<SessionGroup[]> {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[GroupStore] Failed to load groups:', err);
      }
      return [];
    }
  }
}
