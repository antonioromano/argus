import type { AgentRun } from '@argus/shared';
import { formatTokens } from '../../../utils/usageFormat.js';
import { stepPrefix } from './toolSteps.js';

/** How long a strip row stays, with its end mark, after its agent stops running. */
export const AGENT_LINGER_MS = 10_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** "33 s", "2 min 05 s", "1 h 02 min". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ${pad(s % 60)} s`;
  return `${Math.floor(min / 60)} h ${pad(min % 60)} min`;
}

/**
 * A strip row's two halves: who and what (`head`, which truncates first), then
 * how it is going (`meta`). A running agent ticks from `now`; a stopped one
 * shows its run time.
 */
export function agentRowParts(a: AgentRun, now: number, nested = 0): { head: string; meta: string[] } {
  let head = a.description ? `${a.agentType} · ${a.description}` : a.agentType;
  if (nested > 0) head += ` · +${nested} nested`;
  const meta: string[] = [];
  if (a.status === 'running') meta.push(formatElapsed(now - a.startedAt));
  else if (a.finishedAt !== undefined) meta.push(formatElapsed(a.finishedAt - a.startedAt));
  meta.push(`${formatTokens(a.outputTokens)} tokens`);
  if (a.status === 'running' && a.quietMinutes !== undefined) meta.push(`no output for ${a.quietMinutes} min`);
  else if (a.lastStep) {
    const prefix = stepPrefix(a.lastStep);
    meta.push(prefix ? `${prefix} ${a.lastStep.label}` : a.lastStep.label);
  }
  return { head, meta };
}

/** "pre-push-reviewer · Delta review of fix commit · 33 s · 125k tokens · Read handler.ts". */
export function agentRowText(a: AgentRun, now: number, nested = 0): string {
  const { head, meta } = agentRowParts(a, now, nested);
  return [head, ...meta].join(' · ');
}

/** Nested agents per top-level agent: each one counts toward its depth-1 ancestor. */
export function nestedCounts(agents: readonly AgentRun[]): Map<string, number> {
  const parent = new Map(agents.map((a) => [a.id, a.parentAgentId]));
  const counts = new Map<string, number>();
  for (const a of agents) {
    if (a.depth <= 1) continue;
    let up = a.parentAgentId;
    const seen = new Set<string>();
    while (up && parent.get(up) && !seen.has(up)) {
      seen.add(up);
      up = parent.get(up);
    }
    if (up) counts.set(up, (counts.get(up) ?? 0) + 1);
  }
  return counts;
}

/** A depth-1 agent the strip saw running; `stopped` once it ended or left the roster. */
export interface TrackedAgent {
  agent: AgentRun;
  stopped: boolean;
}

/**
 * The strip's tracked agents after a roster update: running depth-1 agents
 * join (or refresh), tracked ones that ended or vanished turn `stopped`.
 * Agents never seen running are never tracked. Returns `prev` when nothing changed.
 */
export function followRoster(prev: ReadonlyMap<string, TrackedAgent>, agents: readonly AgentRun[]): ReadonlyMap<string, TrackedAgent> {
  const byId = new Map(agents.filter((a) => a.depth === 1).map((a) => [a.id, a]));
  let next: Map<string, TrackedAgent> | null = null;
  const edit = () => (next ??= new Map(prev));
  for (const a of byId.values()) {
    const t = prev.get(a.id);
    if (a.status === 'running' && (!t || t.stopped || t.agent !== a)) edit().set(a.id, { agent: a, stopped: false });
  }
  for (const [id, t] of prev) {
    if (t.stopped) continue;
    const cur = byId.get(id);
    if (!cur || cur.status !== 'running') edit().set(id, { agent: cur ?? t.agent, stopped: true });
  }
  return next ?? prev;
}
