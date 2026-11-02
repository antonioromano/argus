/**
 * What an import would change, item by item, for the preview sheet. Unchanged
 * preferences and identical agents/flags are left out entirely; an identical
 * template or launcher is listed as "identical, skipped" so the user sees why
 * it is not counted.
 */
import { DEFAULT_CONFIG, type AgentFlag, type AppConfig, type Launcher, type SessionTemplate } from '@argus/shared';
import { SETTINGS, sameValue, settingValueLabel, type SettingDescriptor } from '../app/overlays/settings/catalog.js';
import { SENSITIVE_PREFERENCE_KEYS } from './schema.js';
import type { ParsedSettings } from './parseSettingsFile.js';

export type ImportSection = 'preferences' | 'agents' | 'flags' | 'templates' | 'launchers';

export const SECTION_ORDER: readonly ImportSection[] = ['preferences', 'agents', 'flags', 'templates', 'launchers'];

export interface ImportItem {
  /** Unique across the plan: `<section>:<id>`. */
  key: string;
  section: ImportSection;
  /** The preference key, agent id, template name or launcher id. */
  ref: string;
  label: string;
  /** Current value; absent for something new. */
  before?: string;
  after: string;
  status: 'new' | 'changed' | 'identical';
  /** Starts unchecked with a warning badge: it changes what runs, or where. */
  sensitive: boolean;
  defaultSelected: boolean;
  note?: string;
  /** Show `before`/`after` in mono (commands, flags). */
  mono?: boolean;
}

export interface ImportPlan {
  items: ImportItem[];
  parsed: ParsedSettings;
}

export interface ImportCurrent {
  config: AppConfig;
  templates: SessionTemplate[];
  launchers: Launcher[];
}

const BUILTIN_NAMES: Record<string, string> = { claude: 'Claude', gemini: 'Gemini CLI', codex: 'Codex', shell: 'Shell' };

/** The catalog row a preference key belongs to (its own row when it has one). */
function descriptorFor(key: keyof AppConfig): SettingDescriptor | undefined {
  return SETTINGS.find((s) => s.id === key)
    ?? SETTINGS.find((s) => s.keys.includes(key) && !s.id.startsWith('shortcut:'));
}

function genericLabel(key: keyof AppConfig, v: unknown): string {
  if (key === 'keyboardShortcuts') {
    const n = Object.keys((v ?? {}) as object).length;
    return n === 0 ? 'Defaults' : `${n} custom binding${n === 1 ? '' : 's'}`;
  }
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(', ') || 'None';
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v ?? '');
}

function prefLabel(key: keyof AppConfig): string {
  if (key === 'keyboardShortcuts') return 'Keyboard shortcuts';
  const d = descriptorFor(key);
  if (!d) return key;
  return d.keys.length > 1 ? `${d.label} (${key})` : d.label;
}

function prefValue(key: keyof AppConfig, value: unknown, config: AppConfig): string {
  const d = descriptorFor(key);
  if (d && d.keys.length === 1 && d.kind !== 'list') {
    return settingValueLabel(d, { ...DEFAULT_CONFIG, ...config, [key]: value } as AppConfig);
  }
  return genericLabel(key, value);
}

const flagText = (flags: AgentFlag[]) => flags.map((f) => f.value).join(' ') || 'None';

function item(partial: Omit<ImportItem, 'key' | 'defaultSelected'> & { defaultSelected?: boolean }): ImportItem {
  return {
    ...partial,
    key: `${partial.section}:${partial.ref}`,
    defaultSelected: partial.defaultSelected ?? (partial.status !== 'identical' && !partial.sensitive),
  };
}

export function diffImport(parsed: ParsedSettings, current: ImportCurrent): ImportPlan {
  const { config } = current;
  const items: ImportItem[] = [];

  for (const [k, value] of Object.entries(parsed.preferences)) {
    const key = k as keyof AppConfig;
    const now = config[key] ?? DEFAULT_CONFIG[key];
    if (sameValue(now, value)) continue;
    items.push(item({
      section: 'preferences',
      ref: key,
      label: prefLabel(key),
      before: prefValue(key, now, config),
      after: prefValue(key, value, config),
      status: 'changed',
      sensitive: SENSITIVE_PREFERENCE_KEYS.includes(key),
      ...(key === 'ptyBackend' ? { note: 'Takes effect after Argus relaunches' } : {}),
    }));
  }

  for (const a of parsed.customAgents) {
    const existing = config.customAgents.find((c) => c.id === a.id);
    if (existing && existing.name === a.name && existing.command === a.command
      && (existing.promptFlag ?? '') === (a.promptFlag ?? '')) continue;
    items.push(item({
      section: 'agents',
      ref: a.id,
      label: a.name,
      ...(existing ? { before: existing.command } : {}),
      after: a.command,
      status: existing ? 'changed' : 'new',
      sensitive: true,
      mono: true,
    }));
  }

  const agentName = (id: string) =>
    BUILTIN_NAMES[id]
    ?? config.customAgents.find((a) => a.id === id)?.name
    ?? parsed.customAgents.find((a) => a.id === id)?.name
    ?? id;
  for (const [agentId, flags] of Object.entries(parsed.agentFlags)) {
    const existing = config.agentFlags?.[agentId];
    const same = existing && existing.length === flags.length
      && existing.every((f, i) => f.value === flags[i].value && f.enabled === flags[i].enabled);
    if (same) continue;
    items.push(item({
      section: 'flags',
      ref: agentId,
      label: `${agentName(agentId)} flags`,
      ...(existing?.length ? { before: flagText(existing) } : {}),
      after: flagText(flags),
      status: existing?.length ? 'changed' : 'new',
      sensitive: true,
      mono: true,
    }));
  }

  for (const t of parsed.templates) {
    const existing = current.templates.find((c) => c.name === t.name);
    const identical = !!existing && sameValue(existing.specs, t.specs);
    const describe = (n: number) => `${n} session${n === 1 ? '' : 's'}`;
    items.push(item({
      section: 'templates',
      ref: t.name,
      label: t.name,
      ...(existing ? { before: describe(existing.specs.length) } : {}),
      after: describe(t.specs.length),
      status: identical ? 'identical' : existing ? 'changed' : 'new',
      sensitive: false,
      ...(identical ? { note: 'Identical, skipped' } : existing ? { note: 'Replaces the template with this name' } : {}),
    }));
  }

  for (const l of parsed.launchers) {
    const existing = current.launchers.find((c) => c.id === l.id);
    const identical = !!existing && existing.label === l.label && sameValue(existing.request, l.request);
    items.push(item({
      section: 'launchers',
      ref: l.id,
      label: l.label,
      ...(existing ? { before: `${existing.request.agent} in ${existing.request.folder}` } : {}),
      after: `${l.request.agent} in ${l.request.folder}`,
      status: identical ? 'identical' : existing ? 'changed' : 'new',
      sensitive: false,
      // An id collision keeps the launcher already here unless the user opts in.
      defaultSelected: !existing,
      note: identical ? 'Identical, skipped' : existing ? `Overwrites launcher “${l.id}”` : 'Will be validated on this Mac',
    }));
  }

  return { items, parsed };
}
