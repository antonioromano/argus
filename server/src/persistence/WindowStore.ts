import { readFile } from 'fs/promises';
import type { ArgusWindow, WindowRegistryState } from '@argus/shared';
import { MAIN_WINDOW_ID } from '../constants/windows.js';
import { atomicWrite } from '../utils/atomicWrite.js';

function defaultState(): WindowRegistryState {
  const main: ArgusWindow = { id: MAIN_WINDOW_ID, label: 'Main', isMain: true, createdAt: Date.now() };
  return { windows: [main], assignments: {} };
}

export class WindowStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async save(state: WindowRegistryState): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(state, null, 2));
  }

  async load(): Promise<WindowRegistryState> {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data) as Partial<WindowRegistryState>;
      const windows = Array.isArray(parsed.windows) ? parsed.windows : [];
      const assignments =
        parsed.assignments && typeof parsed.assignments === 'object' ? parsed.assignments : {};
      if (!windows.some((w) => w.id === MAIN_WINDOW_ID)) {
        windows.unshift(defaultState().windows[0]);
      }
      return { windows, assignments };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[WindowStore] Failed to load windows:', err);
      }
      return defaultState();
    }
  }
}
