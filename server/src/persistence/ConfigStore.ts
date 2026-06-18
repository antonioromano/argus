import { readFile } from 'fs/promises';
import type { AppConfig } from '@argus/shared';
import { atomicWrite } from '../utils/atomicWrite.js';

const DEFAULT_CONFIG: AppConfig = {
  defaultAgent: 'claude',
  customAgents: [],
  agentFlags: {},
  notificationsEnabled: false,
  notifyOnWaiting: true,
  notifyOnDone: false,
  notificationSound: false,
  showClock: false,
  clockShowSeconds: false,
  othersFolderName: 'Others',
  preventSleepWhileRunning: false,
  confirmCloseShell: true,
  exitSessionsOnQuit: false,
  confirmExitOnQuit: true,
  keyboardShortcuts: {},
};

export class ConfigStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async save(config: AppConfig): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(config, null, 2));
  }

  async load(): Promise<AppConfig> {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[ConfigStore] Failed to load config:', err);
      }
      return { ...DEFAULT_CONFIG };
    }
  }
}
