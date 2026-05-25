import { readFile } from 'fs/promises';
import { atomicWrite } from '../utils/atomicWrite.js';

export class OrderStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async save(order: string[]): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(order, null, 2));
  }

  async load(): Promise<string[]> {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[OrderStore] Failed to load order:', err);
      }
      return [];
    }
  }
}
