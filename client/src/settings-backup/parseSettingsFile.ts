/**
 * Reads a settings file for the import preview. The file is untrusted: every
 * section is type-checked, anything unknown is dropped (and named, so the
 * preview can say "not recognized"), and items the server would refuse are
 * left out with a reason. The server stays the authority — it re-validates the
 * config PUT, the template saves and (in main) every launcher.
 */
import {
  TEMPLATE_MAX_SPECS,
  TEMPLATE_NAME_MAX,
  TEMPLATE_PROMPT_MAX,
  type AgentFlag,
  type AppConfig,
  type LaunchRequest,
  type TemplateSpec,
} from '@argus/shared';
import {
  BUILTIN_AGENT_IDS,
  EXPORTABLE_PREFERENCE_KEYS,
  SETTINGS_FILE_KIND,
  SETTINGS_FILE_MAX_BYTES,
  SETTINGS_FILE_MAX_LAUNCHERS,
  SETTINGS_FILE_VERSION,
  preferenceShape,
  type ExportedAgent,
  type ExportedLauncher,
  type ExportedTemplate,
} from './schema.js';

// Copies of the server's patterns (server/src/routes/config.ts, FLAG_PATTERN and
// COMMAND_PATTERN), used only to flag problems in the preview. The server
// re-checks; scripts/check-dep-sync.mjs fails if the two copies drift.
export const FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9\-_.=:,/ ]*$/;
export const COMMAND_PATTERN = /^[a-zA-Z0-9_@./\- ]+$/;
const PROMPT_FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9-]*$/;
/** LaunchService's launcher id rule (server/src/services/launch/LaunchService.ts). */
const LAUNCHER_ID = /^[a-z0-9-]{1,40}$/;

export interface ParsedSettings {
  preferences: Partial<AppConfig>;
  customAgents: ExportedAgent[];
  agentFlags: Record<string, AgentFlag[]>;
  templates: ExportedTemplate[];
  launchers: ExportedLauncher[];
  /** Keys the file carried that this version does not import (names only, never values). */
  unrecognized: string[];
  /** Items left out because they would be refused, one sentence each. */
  problems: string[];
}

export type ParseResult = { ok: true; value: ParsedSettings } | { ok: false; error: string };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown): v is string | undefined => v === undefined || isStr(v);

const TOP_LEVEL = new Set(['kind', 'version', 'exportedAt', 'appVersion', 'preferences', 'customAgents', 'agentFlags', 'templates', 'launchers']);
const EXPORTABLE = new Set<string>(EXPORTABLE_PREFERENCE_KEYS);

function parsePreferences(raw: unknown, out: ParsedSettings) {
  if (raw === undefined) return;
  if (!isObj(raw)) { out.problems.push('Preferences are not an object, so none were read.'); return; }
  for (const [key, value] of Object.entries(raw)) {
    if (!EXPORTABLE.has(key)) { out.unrecognized.push(key); continue; }
    const shape = preferenceShape(key as keyof AppConfig);
    const ok = shape === 'array' ? Array.isArray(value)
      : shape === 'object' ? isObj(value)
        : typeof value === shape;
    if (!ok || (key === 'keyboardShortcuts' && !Object.values(value as Obj).every(isStr))) {
      out.problems.push(`Preference “${key}” has the wrong type and was left out.`);
      continue;
    }
    (out.preferences as Obj)[key] = value;
  }
}

function parseAgents(raw: unknown, out: ParsedSettings) {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) { out.problems.push('Custom agents are not a list, so none were read.'); return; }
  const seen = new Set<string>();
  for (const a of raw) {
    const name = isObj(a) && isStr(a.name) ? a.name : 'unnamed';
    if (!isObj(a) || !isStr(a.id) || !a.id.trim() || !isStr(a.name) || !a.name.trim() || !isStr(a.command)) {
      out.problems.push(`Custom agent “${name}” is missing an id, name or command.`);
      continue;
    }
    if (BUILTIN_AGENT_IDS.includes(a.id)) {
      out.problems.push(`Custom agent “${name}” uses the built-in id “${a.id}”.`);
      continue;
    }
    if (seen.has(a.id)) { out.problems.push(`Custom agent “${name}” repeats the id “${a.id}”.`); continue; }
    if (!COMMAND_PATTERN.test(a.command.trim())) {
      out.problems.push(`Custom agent “${name}” has an unsafe command and was blocked: ${a.command}`);
      continue;
    }
    if (!optStr(a.promptFlag) || (a.promptFlag !== undefined && !PROMPT_FLAG_PATTERN.test(a.promptFlag))) {
      out.problems.push(`Custom agent “${name}” has an invalid prompt flag.`);
      continue;
    }
    seen.add(a.id);
    out.customAgents.push({
      id: a.id,
      name: a.name.trim(),
      command: a.command.trim(),
      ...(a.promptFlag ? { promptFlag: a.promptFlag } : {}),
      ...(isStr(a.installUrl) && /^https:\/\//.test(a.installUrl) ? { installUrl: a.installUrl } : {}),
    });
  }
}

function parseFlags(raw: unknown, out: ParsedSettings) {
  if (raw === undefined) return;
  if (!isObj(raw)) { out.problems.push('Agent flags are not an object, so none were read.'); return; }
  for (const [agentId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) { out.problems.push(`Flags for “${agentId}” are not a list.`); continue; }
    const flags: AgentFlag[] = [];
    for (const f of list) {
      if (!isObj(f) || !isStr(f.id) || !isStr(f.value)) {
        out.problems.push(`A flag for “${agentId}” is malformed and was left out.`);
        continue;
      }
      if (!FLAG_PATTERN.test(f.value.trim())) {
        out.problems.push(`Flag “${f.value}” for “${agentId}” has unsafe characters and was blocked.`);
        continue;
      }
      flags.push({ id: f.id, value: f.value.trim(), enabled: f.enabled === true });
    }
    if (flags.length) out.agentFlags[agentId] = flags;
  }
}

function parseSpec(s: unknown): TemplateSpec | null {
  if (!isObj(s) || !isStr(s.agent) || !isStr(s.folder)) return null;
  if (!optStr(s.worktreeBranch) || !optStr(s.prompt) || !optStr(s.name)) return null;
  if (s.prompt !== undefined && s.prompt.length > TEMPLATE_PROMPT_MAX) return null;
  return {
    agent: s.agent,
    folder: s.folder,
    ...(s.worktreeBranch ? { worktreeBranch: s.worktreeBranch } : {}),
    ...(s.prompt ? { prompt: s.prompt } : {}),
    ...(s.name ? { name: s.name } : {}),
  };
}

function parseTemplates(raw: unknown, out: ParsedSettings) {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) { out.problems.push('Templates are not a list, so none were read.'); return; }
  for (const t of raw) {
    const name = isObj(t) && isStr(t.name) ? t.name.trim() : '';
    const specs = isObj(t) && Array.isArray(t.specs) ? t.specs.map(parseSpec) : null;
    if (!name || name.length > TEMPLATE_NAME_MAX || !specs || specs.length === 0
      || specs.length > TEMPLATE_MAX_SPECS || specs.some((s) => s === null)) {
      out.problems.push(`Template “${name || 'unnamed'}” is malformed and was left out.`);
      continue;
    }
    out.templates.push({ name, specs: specs as TemplateSpec[] });
  }
}

function parseRequest(r: unknown): LaunchRequest | null {
  if (!isObj(r) || !isStr(r.agent) || !isStr(r.folder)) return null;
  if (!Array.isArray(r.flags) || !r.flags.every(isStr)) return null;
  if (!optStr(r.prompt) || !optStr(r.name)) return null;
  if (r.engine !== undefined && r.engine !== 'web' && r.engine !== 'native') return null;
  if (r.mode !== undefined && r.mode !== 'persistent' && r.mode !== 'direct') return null;
  // No worktree/base: a launcher can't create a worktree (LaunchService.add).
  return {
    agent: r.agent,
    folder: r.folder,
    flags: [...r.flags],
    ...(r.prompt !== undefined ? { prompt: r.prompt } : {}),
    ...(r.engine !== undefined ? { engine: r.engine } : {}),
    ...(r.mode !== undefined ? { mode: r.mode } : {}),
    ...(r.name !== undefined ? { name: r.name } : {}),
  };
}

function parseLaunchers(raw: unknown, out: ParsedSettings) {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) { out.problems.push('Launchers are not a list, so none were read.'); return; }
  if (raw.length > SETTINGS_FILE_MAX_LAUNCHERS) {
    out.problems.push(`The file lists ${raw.length} launchers; only the first ${SETTINGS_FILE_MAX_LAUNCHERS} were read.`);
  }
  const seen = new Set<string>();
  for (const l of raw.slice(0, SETTINGS_FILE_MAX_LAUNCHERS)) {
    const id = isObj(l) && isStr(l.id) ? l.id : '';
    const request = isObj(l) ? parseRequest(l.request) : null;
    if (!LAUNCHER_ID.test(id) || !isObj(l) || !isStr(l.label) || !l.label.trim() || !request || seen.has(id)) {
      out.problems.push(`Launcher “${id || 'unnamed'}” is malformed and was left out.`);
      continue;
    }
    seen.add(id);
    out.launchers.push({ id, label: l.label.trim(), request });
  }
}

export function parseSettingsFile(text: string): ParseResult {
  if (text.length > SETTINGS_FILE_MAX_BYTES) return { ok: false, error: 'The file is larger than 1 MB, so it is not an Argus settings file.' };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (!isObj(doc)) return { ok: false, error: 'The file is not an Argus settings file.' };
  if (doc.kind !== SETTINGS_FILE_KIND) return { ok: false, error: 'The file is not an Argus settings file.' };
  if (doc.version !== SETTINGS_FILE_VERSION) {
    return { ok: false, error: `The file is version ${String(doc.version)}; this Argus reads version ${SETTINGS_FILE_VERSION}. Update Argus and try again.` };
  }

  const out: ParsedSettings = {
    preferences: {}, customAgents: [], agentFlags: {}, templates: [], launchers: [], unrecognized: [], problems: [],
  };
  for (const key of Object.keys(doc)) if (!TOP_LEVEL.has(key)) out.unrecognized.push(key);
  parsePreferences(doc.preferences, out);
  parseAgents(doc.customAgents, out);
  parseFlags(doc.agentFlags, out);
  parseTemplates(doc.templates, out);
  parseLaunchers(doc.launchers, out);
  return { ok: true, value: out };
}
