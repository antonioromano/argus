import type { SaveTemplateRequest, SessionTemplate, TemplateSpec } from '@argus/shared';

/** Beta F10 editor model: every field a string while editing; `toRequest` trims and drops empties. */
export interface DraftSpec { agent: string; folder: string; worktreeBranch: string; prompt: string; name: string }
export interface Draft { id: string | null; name: string; specs: DraftSpec[] }

export const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
export const blankSpec = (agent: string): DraftSpec => ({ agent, folder: '', worktreeBranch: '', prompt: '', name: '' });

export function toRequest(d: Draft): SaveTemplateRequest {
  return {
    name: d.name.trim(),
    specs: d.specs.map((s) => {
      const spec: TemplateSpec = { agent: s.agent, folder: s.folder.trim() };
      if (s.worktreeBranch.trim()) spec.worktreeBranch = s.worktreeBranch.trim();
      if (s.prompt.trim()) spec.prompt = s.prompt;
      if (s.name.trim()) spec.name = s.name.trim();
      return spec;
    }),
  };
}

export function fromTemplate(t: SessionTemplate): Draft {
  return {
    id: t.id,
    name: t.name,
    specs: t.specs.map((s) => ({ agent: s.agent, folder: s.folder, worktreeBranch: s.worktreeBranch ?? '', prompt: s.prompt ?? '', name: s.name ?? '' })),
  };
}

/** One line per spec — the same words the launch confirm and the list use. */
export function describeSpec(s: TemplateSpec): string {
  const parts = [`${s.name ?? base(s.folder)} — ${s.agent} @ ${s.folder}`];
  if (s.worktreeBranch) parts.push(`new worktree ${s.worktreeBranch}`);
  if (s.prompt) parts.push(`prompt “${s.prompt.length > 60 ? `${s.prompt.slice(0, 60)}…` : s.prompt}”`);
  return parts.join(' · ');
}
