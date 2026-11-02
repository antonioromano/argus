import type { AppConfig, Launcher, SessionTemplate } from '@argus/shared';
import {
  EXPORTABLE_PREFERENCE_KEYS,
  SETTINGS_FILE_KIND,
  SETTINGS_FILE_VERSION,
  exportAgent,
  type SettingsFile,
} from './schema.js';

export interface ExportSources {
  config: AppConfig;
  /** Saved templates; empty while the templates beta is off. */
  templates: SessionTemplate[];
  launchers: Launcher[];
  now?: Date;
  appVersion?: string;
}

/** The backup document for the current state. Pure: callers fetch the inputs. */
export function buildExport({ config, templates, launchers, now = new Date(), appVersion }: ExportSources): SettingsFile {
  const preferences: Partial<AppConfig> = {};
  for (const key of EXPORTABLE_PREFERENCE_KEYS) {
    const value = config[key];
    if (value !== undefined) (preferences as Record<string, unknown>)[key] = structuredClone(value);
  }
  return {
    kind: SETTINGS_FILE_KIND,
    version: SETTINGS_FILE_VERSION,
    exportedAt: now.toISOString(),
    ...(appVersion ? { appVersion } : {}),
    preferences,
    customAgents: config.customAgents.map(exportAgent),
    agentFlags: structuredClone(config.agentFlags ?? {}),
    templates: templates.map((t) => ({ name: t.name, specs: structuredClone(t.specs) })),
    launchers: launchers.map((l) => ({ id: l.id, label: l.label, request: structuredClone(l.request) })),
  };
}

export function serializeExport(file: SettingsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

