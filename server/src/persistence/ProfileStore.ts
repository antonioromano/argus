import { readFile, copyFile } from 'fs/promises';
import type { ProfilesState } from '@argus/shared';
import { atomicWrite } from '../utils/atomicWrite.js';
import { sanitizeProfilesState } from '../services/profiles.js';

export const EMPTY_PROFILES: ProfilesState = { activeId: null, profiles: [], prompt: 'pending' };

/**
 * Profiles (server/data/profiles.json): named bundles of look-and-feel choices.
 * A file of its own rather than an AppConfig key, so a profile write can never
 * touch anything beyond the allowlisted keys sanitizeProfilesState keeps.
 * A malformed file loads as no profiles (after a .bak copy), never as a crash.
 */
export class ProfileStore {
  constructor(private filePath: string) {}

  async load(): Promise<ProfilesState> {
    try {
      const parsed = sanitizeProfilesState(JSON.parse(await readFile(this.filePath, 'utf-8')));
      return parsed ?? structuredClone(EMPTY_PROFILES);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[ProfileStore] load failed:', err);
        if (err instanceof SyntaxError) {
          await copyFile(this.filePath, `${this.filePath}.bak`).catch((e) => console.warn('[ProfileStore] backup failed:', e));
        }
      }
      return structuredClone(EMPTY_PROFILES);
    }
  }

  async save(state: ProfilesState): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(state, null, 2));
  }
}
