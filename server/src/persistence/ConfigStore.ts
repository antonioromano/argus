import { readFile } from 'fs/promises';
import type { AppConfig } from '@argus/shared';
import { atomicWrite } from '../utils/atomicWrite.js';

/**
 * The shipped defaults a partial config file is merged over.
 *
 * Deliberately a literal here rather than an import of shared's DEFAULT_CONFIG,
 * even though the two must agree (ConfigStore.defaults.test.ts pins them): every
 * other server import from `@argus/shared` is `import type`, so nothing in the
 * running server ever loads shared/src/types.ts. Importing a *value* from it
 * would make Electron's Node parse a TypeScript file at boot — which works only
 * because current Node strips types by default, and is not something app
 * startup should depend on. The renderer gets the shared copy through Vite,
 * where it is compiled like any other source file.
 */
export const DEFAULT_CONFIG: AppConfig = {
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
  uiFontSize: 14,
  codeFontSize: 13,
  mosaicWaitingStyle: 'breathing',
  mosaicOrientation: 'horizontal',
  debugToolsEnabled: false,
  ptyBackend: 'auto',
  tileQuickAction: 'diff',
  tileRunningIndicator: 'hairline',
  quickActionPromptedAt: '',
  defaultTerminalEngine: 'web',
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
