/**
 * Applies the items the user kept in the import preview, in three ordered
 * writes:
 *
 * 1. One config PUT: preferences, custom agents (merged by id) and their flags.
 *    The server validates it as a whole; a 400 aborts the import before
 *    anything else is written.
 * 2. Templates, one save each — only when the templates beta is on *after*
 *    step 1 (the file may be what turns it on). A refused template is reported
 *    and the rest continue.
 * 3. Launchers, through Electron main, which re-validates each request on this
 *    Mac (folder, agent) before saving it. Failures are reported per launcher.
 */
import type { AgentDefinition, AppConfig, LaunchRequest, SaveTemplateRequest } from '@argus/shared';
import type { ImportCurrent, ImportItem, ImportPlan } from './diffImport.js';
import { describeError } from '../errors/describeError.js';

export interface LauncherImportItem {
  id: string;
  label: string;
  request: LaunchRequest;
  overwrite: boolean;
}

export interface LauncherImportResult {
  id: string;
  ok: boolean;
  error?: string;
}

export interface ApplyDeps {
  updateConfig(patch: Partial<AppConfig>): Promise<AppConfig>;
  createTemplate(req: SaveTemplateRequest): Promise<unknown>;
  updateTemplate(id: string, req: SaveTemplateRequest): Promise<unknown>;
  importLaunchers(items: LauncherImportItem[]): Promise<LauncherImportResult[]>;
}

export interface ApplyResult {
  /** False when the config write was refused; nothing was applied then. */
  ok: boolean;
  error?: string;
  preferences: number;
  agents: number;
  flags: number;
  templates: { applied: number; failed: { name: string; error: string }[]; skippedReason?: string };
  launchers: { applied: number; failed: { id: string; error: string }[] };
}

/** A failure's words for the summary: a typed error's mapped title (never
 *  "Argus server unreachable" / "spawn … ENOENT"), else the server's reason
 *  (config validation messages are written for the user). */
const errorText = (err: unknown) => {
  const d = describeError(err);
  return d.code ? d.title : (d.detail ?? d.title);
};

/** What the config PUT carries for the selected items. Agents and flags are
 *  merged into the current lists, so an import never deletes one. */
export function configPatch(plan: ImportPlan, picked: (i: ImportItem) => boolean, current: AppConfig): Partial<AppConfig> {
  const { parsed } = plan;
  const patch: Partial<AppConfig> = {};
  const chosen = plan.items.filter(picked);

  for (const i of chosen.filter((x) => x.section === 'preferences')) {
    (patch as Record<string, unknown>)[i.ref] = structuredClone((parsed.preferences as Record<string, unknown>)[i.ref]);
  }

  const agentIds = new Set(chosen.filter((x) => x.section === 'agents').map((x) => x.ref));
  if (agentIds.size) {
    const incoming = parsed.customAgents.filter((a) => agentIds.has(a.id));
    const merged: AgentDefinition[] = current.customAgents.map((a) => {
      const next = incoming.find((n) => n.id === a.id);
      return next ? { ...a, ...next, builtin: false } : a;
    });
    for (const a of incoming) {
      if (!merged.some((m) => m.id === a.id)) merged.push({ ...a, builtin: false });
    }
    patch.customAgents = merged;
  }

  const flagIds = chosen.filter((x) => x.section === 'flags').map((x) => x.ref);
  if (flagIds.length) {
    patch.agentFlags = { ...structuredClone(current.agentFlags ?? {}) };
    for (const id of flagIds) patch.agentFlags[id] = structuredClone(parsed.agentFlags[id]);
  }
  return patch;
}

export async function applyImport(
  plan: ImportPlan,
  selected: ReadonlySet<string>,
  current: ImportCurrent,
  deps: ApplyDeps,
): Promise<ApplyResult> {
  const picked = (i: ImportItem) => selected.has(i.key) && i.status !== 'identical';
  const count = (section: ImportItem['section']) => plan.items.filter((i) => i.section === section && picked(i)).length;
  const result: ApplyResult = {
    ok: true,
    preferences: 0,
    agents: 0,
    flags: 0,
    templates: { applied: 0, failed: [] },
    launchers: { applied: 0, failed: [] },
  };

  // 1. Config: all or nothing.
  let config = current.config;
  const patch = configPatch(plan, picked, current.config);
  if (Object.keys(patch).length) {
    try {
      config = await deps.updateConfig(patch);
    } catch (err) {
      return { ...result, ok: false, error: errorText(err) };
    }
  }
  result.preferences = count('preferences');
  result.agents = count('agents');
  result.flags = count('flags');

  // 2. Templates, once the beta that hosts them is known to be on.
  const templates = plan.items.filter((i) => i.section === 'templates' && picked(i));
  if (templates.length && config.betaSessionTemplates !== true) {
    result.templates.skippedReason = 'the Session templates beta is off';
  } else {
    for (const i of templates) {
      const t = plan.parsed.templates.find((x) => x.name === i.ref)!;
      const existing = current.templates.find((x) => x.name === t.name);
      try {
        if (existing) await deps.updateTemplate(existing.id, { name: t.name, specs: t.specs });
        else await deps.createTemplate({ name: t.name, specs: t.specs });
        result.templates.applied++;
      } catch (err) {
        result.templates.failed.push({ name: t.name, error: errorText(err) });
      }
    }
  }

  // 3. Launchers, validated by main against this Mac.
  const launchers: LauncherImportItem[] = plan.items
    .filter((i) => i.section === 'launchers' && picked(i))
    .map((i) => {
      const l = plan.parsed.launchers.find((x) => x.id === i.ref)!;
      return { id: l.id, label: l.label, request: l.request, overwrite: i.status === 'changed' };
    });
  if (launchers.length) {
    let outcomes: LauncherImportResult[];
    try {
      outcomes = await deps.importLaunchers(launchers);
    } catch (err) {
      outcomes = launchers.map((l) => ({ id: l.id, ok: false, error: errorText(err) }));
    }
    for (const o of outcomes) {
      if (o.ok) result.launchers.applied++;
      else result.launchers.failed.push({ id: o.id, error: o.error ?? 'refused' });
    }
  }
  return result;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line for the result toast: what came in, then what did not. */
export function importSummary(r: ApplyResult): string {
  if (!r.ok) return `Import failed: ${r.error ?? 'the settings were refused'}. Nothing was changed.`;
  const done = [
    r.preferences && plural(r.preferences, 'setting'),
    r.agents && plural(r.agents, 'agent'),
    r.flags && plural(r.flags, 'flag set'),
    r.templates.applied && plural(r.templates.applied, 'template'),
    r.launchers.applied && plural(r.launchers.applied, 'launcher'),
  ].filter(Boolean);
  const head = done.length ? `Imported ${done.join(', ')}` : 'Nothing was imported';
  const misses: string[] = [];
  if (r.templates.skippedReason) misses.push(`templates skipped: ${r.templates.skippedReason}`);
  for (const t of r.templates.failed) misses.push(`template “${t.name}” skipped: ${t.error}`);
  for (const l of r.launchers.failed) misses.push(`launcher “${l.id}” skipped: ${l.error}`);
  return misses.length ? `${head} · ${misses.join(' · ')}` : head;
}
