/**
 * The settings backup file: what Export writes and Import reads.
 *
 * One JSON document, versioned. It carries preferences (the keys the settings
 * panes own), custom agents and their flags, saved templates and launchers.
 * Never secrets: the remote-access password, auth tokens and the ngrok
 * authtoken are not in AppConfig at all, and anything a file carries beyond the
 * keys listed here is dropped on import. Excluded on purpose for v1 (roadmap
 * 000): auto-approval rules (they grant tool permissions per folder) and the
 * device-local theme.
 */
import type { AgentDefinition, AgentFlag, AppConfig, LaunchRequest, TemplateSpec } from '@argus/shared';
import { DEFAULT_CONFIG } from '@argus/shared';
import { PANES } from '../app/overlays/settings/registry.js';

export const SETTINGS_FILE_KIND = 'argus-settings';
export const SETTINGS_FILE_VERSION = 1;
/** Largest file Import reads (Electron main enforces the same cap before reading). */
export const SETTINGS_FILE_MAX_BYTES = 1_000_000;
/** Launchers per file; main refuses a longer import list too. */
export const SETTINGS_FILE_MAX_LAUNCHERS = 100;

type ConfigKey = keyof AppConfig;

/** Custom agents and their flags travel as their own sections, not as preferences. */
export const AGENT_SECTION_KEYS: readonly ConfigKey[] = ['customAgents', 'agentFlags'];

/** Config keys that are bookkeeping or window layout, not preferences: which
 *  intro was seen, when the quick-action picker ran, the inspector's dragged
 *  width and collapsed sections, which tips were shown. Never exported. */
export const EXPORT_EXCLUDED_KEYS: readonly ConfigKey[] = [
  'quickActionPromptedAt',
  'introSeen',
  'inspectorWidth',
  'inspectorCollapsed',
  // Tips shown, checklist progress (plan 006): per-install history.
  'discovery',
];

/** Every key a settings pane owns, minus the agent sections. Derived from the
 *  catalog so a new setting is exported without a second list to update;
 *  schema.test.ts fails when a DEFAULT_CONFIG key is in none of the three groups. */
export const EXPORTABLE_PREFERENCE_KEYS: readonly ConfigKey[] = [...new Set(PANES.flatMap((p) => p.keys))]
  .filter((k) => !AGENT_SECTION_KEYS.includes(k) && !EXPORT_EXCLUDED_KEYS.includes(k));

/** Preferences an import leaves unchecked until the user opts in: they widen
 *  what runs unattended, change where launch links may point, or swap the
 *  process backend (relaunch). */
export const SENSITIVE_PREFERENCE_KEYS: readonly ConfigKey[] = ['autoApprovalEnabled', 'launchFolderRoots', 'ptyBackend'];

/** Built-in agent ids. A custom agent with one of these would be shadowed by
 *  the built-in at spawn, so neither the parser nor the server accepts it. */
export const BUILTIN_AGENT_IDS: readonly string[] = ['claude', 'gemini', 'codex', 'shell'];

export interface ExportedAgent {
  id: string;
  name: string;
  command: string;
  promptFlag?: string;
  installUrl?: string;
}

export interface ExportedTemplate {
  name: string;
  specs: TemplateSpec[];
}

/** A launcher as exported: no `agentCommand`, `folderConfigAtSave` or
 *  `createdAt` — those describe the exporting Mac and are recomputed when the
 *  importing one validates the request. */
export interface ExportedLauncher {
  id: string;
  label: string;
  request: LaunchRequest;
}

export interface SettingsFile {
  kind: typeof SETTINGS_FILE_KIND;
  version: typeof SETTINGS_FILE_VERSION;
  exportedAt: string;
  appVersion?: string;
  preferences: Partial<AppConfig>;
  customAgents: ExportedAgent[];
  agentFlags: Record<string, AgentFlag[]>;
  templates: ExportedTemplate[];
  launchers: ExportedLauncher[];
}

/** Narrow a custom agent to what the file carries. */
export function exportAgent(a: AgentDefinition): ExportedAgent {
  return {
    id: a.id,
    name: a.name,
    command: a.command,
    ...(a.promptFlag ? { promptFlag: a.promptFlag } : {}),
    ...(a.installUrl ? { installUrl: a.installUrl } : {}),
  };
}

/** The shape every DEFAULT_CONFIG key has, for the parser's type check. */
export function preferenceShape(key: ConfigKey): 'boolean' | 'number' | 'string' | 'array' | 'object' {
  const v = DEFAULT_CONFIG[key];
  if (Array.isArray(v)) return 'array';
  if (v === null || v === undefined) return 'object';
  return typeof v as 'boolean' | 'number' | 'string' | 'object';
}
