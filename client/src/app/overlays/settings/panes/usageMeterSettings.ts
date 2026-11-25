import type { PlanUsage, SessionUsage, UsageMeterPart, UsageMeterPartId, UsageWarnThresholds } from '@argus/shared';

export const PART_LABELS: Record<UsageMeterPartId, string> = {
  ctx: 'Context',
  plan: 'Plan usage',
  tok: 'Tokens',
  model: 'Model',
};

/** Move the part at `from` to index `to`. */
export function movePart(parts: readonly UsageMeterPart[], from: number, to: number): UsageMeterPart[] {
  const next = parts.slice();
  if (from < 0 || from >= next.length) return next;
  const [p] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, p!);
  return next;
}

export const STEP = 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Raise or lower one threshold, keeping 5 ≤ amber < red ≤ 99. */
export function stepThreshold(t: UsageWarnThresholds, which: 'amber' | 'red', delta: number): UsageWarnThresholds {
  if (which === 'amber') {
    const amber = clamp(t.amber + delta, 5, 98);
    return { amber, red: t.red > amber ? t.red : Math.min(99, amber + STEP) };
  }
  const red = clamp(t.red + delta, 6, 99);
  return { amber: t.amber < red ? t.amber : Math.max(5, red - STEP), red };
}


export type PreviewAgent = 'claude' | 'codex' | 'gemini';

/** Synthetic meter for the preview tile — never real data. */
export function previewData(agent: PreviewAgent, ctxPct: number, planPct: number, now: number): { usage: SessionUsage; plan: PlanUsage } {
  const codex = agent === 'codex';
  const window = codex ? 258_400 : 200_000;
  const contextTokens = Math.round((window * ctxPct) / 100);
  return {
    usage: {
      inputTokens: 1_200_000,
      outputTokens: 310_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 18_400_000,
      totalTokens: 19_910_000,
      model: codex ? 'gpt-5.5' : 'claude-opus-5-5',
      contextTokens,
      contextWindow: window,
      contextPct: ctxPct,
      updatedAt: now,
    },
    plan: codex
      ? { observedAt: now, primary: { usedPct: planPct, windowMinutes: 43_200, resetsAt: now + 6 * 86_400_000 } }
      : {
          observedAt: now,
          primary: { usedPct: planPct, windowMinutes: 300, resetsAt: now + (2 * 60 + 19) * 60_000 },
          secondary: { usedPct: Math.round(planPct * 0.4), windowMinutes: 10_080, resetsAt: now + 4 * 86_400_000 },
        },
  };
}
