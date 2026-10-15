import type { AgentDefinition, TemplateSpec } from '@argus/shared';
import { promptArgs } from './AgentRegistry.js';
import { shquote } from './PtyManager.js';
import { MAX_QUOTED_BYTES } from './launch/validateLaunch.js';
import { resolveSessionFolder } from '../utils/sessionFolder.js';
import { isSafeRef } from '../routes/git.js';
import { SESSION_NAME_MAX } from '../constants/session.js';
import { TEMPLATE_MAX_SPECS, TEMPLATE_NAME_MAX, TEMPLATE_PROMPT_MAX } from '../constants/templates.js';

/** The rule SessionManager.createSession applies to a new worktree branch. */
const BRANCH_RE = /^(?!-)[A-Za-z0-9._/-]+$/;
const BRANCH_MAX = 200;

export interface SpecError { index: number; error: string }

export type ParsedTemplate =
  | { ok: true; name: string; specs: TemplateSpec[] }
  | { ok: false; error: string; specErrors?: SpecError[] };

const str = (v: unknown): v is string => typeof v === 'string';

/** Shape check of one spec; trims and drops empty optionals. */
function parseSpec(raw: unknown): { ok: true; spec: TemplateSpec } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Spec must be an object' };
  const r = raw as Record<string, unknown>;
  if (!str(r.agent) || !r.agent.trim()) return { ok: false, error: 'Agent is required' };
  if (!str(r.folder) || !r.folder.trim()) return { ok: false, error: 'Folder is required' };
  for (const k of ['worktreeBranch', 'prompt', 'name'] as const) {
    if (r[k] !== undefined && r[k] !== null && !str(r[k])) return { ok: false, error: `${k} must be a string` };
  }
  const spec: TemplateSpec = { agent: r.agent.trim(), folder: r.folder.trim() };
  const branch = str(r.worktreeBranch) ? r.worktreeBranch.trim() : '';
  if (branch) spec.worktreeBranch = branch;
  const prompt = str(r.prompt) ? r.prompt : '';
  if (prompt.length > TEMPLATE_PROMPT_MAX) return { ok: false, error: `Prompt is longer than ${TEMPLATE_PROMPT_MAX} characters` };
  if (prompt.trim()) spec.prompt = prompt;
  const name = str(r.name) ? r.name.trim() : '';
  if (name.length > SESSION_NAME_MAX) return { ok: false, error: `Name is longer than ${SESSION_NAME_MAX} characters` };
  if (name) spec.name = name;
  return { ok: true, spec };
}

/** Shape check of a save body: name, 1–TEMPLATE_MAX_SPECS specs, field types and lengths. */
export function parseTemplateInput(raw: unknown): ParsedTemplate {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = str(b.name) ? b.name.trim() : '';
  if (!name) return { ok: false, error: 'Template name is required' };
  if (name.length > TEMPLATE_NAME_MAX) return { ok: false, error: `Template name is longer than ${TEMPLATE_NAME_MAX} characters` };
  if (!Array.isArray(b.specs) || b.specs.length === 0) return { ok: false, error: 'A template needs at least one session' };
  if (b.specs.length > TEMPLATE_MAX_SPECS) return { ok: false, error: `A template holds at most ${TEMPLATE_MAX_SPECS} sessions` };
  const specs: TemplateSpec[] = [];
  const specErrors: SpecError[] = [];
  b.specs.forEach((s, index) => {
    const p = parseSpec(s);
    if (p.ok) specs.push(p.spec);
    else specErrors.push({ index, error: p.error });
  });
  if (specErrors.length) return { ok: false, error: 'Some sessions are invalid', specErrors };
  return { ok: true, name, specs };
}

export interface SpecValidationDeps {
  agentRegistry: { getById(id: string, customAgents: AgentDefinition[]): AgentDefinition | undefined };
  customAgents: AgentDefinition[];
}

/**
 * Full check of one parsed spec, run on save AND again on launch (a folder can
 * vanish, a custom agent can be deleted). Same rules as session creation:
 * a registered agent, an absolute existing directory (returned realpath'd),
 * a branch createSession accepts, and a prompt the agent takes on its
 * command line and that still fits once quoted.
 */
export async function validateSpec(spec: TemplateSpec, deps: SpecValidationDeps): Promise<{ ok: true; spec: TemplateSpec } | { ok: false; error: string }> {
  const agent = deps.agentRegistry.getById(spec.agent, deps.customAgents);
  if (!agent) return { ok: false, error: `Unknown agent "${spec.agent}"` };
  let folder: string;
  try {
    folder = await resolveSessionFolder(spec.folder);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid folder' };
  }
  if (spec.worktreeBranch !== undefined) {
    const b = spec.worktreeBranch;
    if (!isSafeRef(b) || !BRANCH_RE.test(b) || b.length > BRANCH_MAX || b.endsWith('/') || b.endsWith('.lock')) {
      return { ok: false, error: `Invalid branch name "${b}"` };
    }
  }
  if (spec.prompt !== undefined) {
    if (spec.prompt.length > TEMPLATE_PROMPT_MAX) return { ok: false, error: `Prompt is longer than ${TEMPLATE_PROMPT_MAX} characters` };
    if (spec.prompt.trimStart().startsWith('-')) return { ok: false, error: 'Prompt must not start with "-"' };
    const args = promptArgs(agent, spec.prompt);
    if (!args) return { ok: false, error: `Agent "${agent.name}" does not accept an initial prompt` };
    const inner = `exec ${[agent.command, ...args.map(shquote)].join(' ')}`;
    if (Buffer.byteLength(shquote(inner)) > MAX_QUOTED_BYTES) return { ok: false, error: 'Prompt is too long once quoted' };
  }
  return { ok: true, spec: { ...spec, agent: agent.id, folder } };
}

/** Validate every spec; per-spec errors by index, or the normalized specs. */
export async function validateSpecs(specs: TemplateSpec[], deps: SpecValidationDeps): Promise<{ ok: true; specs: TemplateSpec[] } | { ok: false; specErrors: SpecError[] }> {
  const results = await Promise.all(specs.map((s) => validateSpec(s, deps)));
  const specErrors = results.flatMap((r, index) => (r.ok ? [] : [{ index, error: r.error }]));
  if (specErrors.length) return { ok: false, specErrors };
  return { ok: true, specs: results.map((r) => (r as { ok: true; spec: TemplateSpec }).spec) };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The template's name, or — when a group already has it — the name plus a local timestamp. */
export function uniqueGroupName(base: string, taken: ReadonlySet<string>, now: Date): string {
  if (!taken.has(base)) return base;
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const minute = `${base} · ${day} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (!taken.has(minute)) return minute;
  const second = `${minute}:${pad(now.getSeconds())}`;
  if (!taken.has(second)) return second;
  for (let i = 2; ; i++) if (!taken.has(`${second} (${i})`)) return `${second} (${i})`;
}
