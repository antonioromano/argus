import type { UsageMeterPart, UsageMeterPartId, UsageWarnThresholds } from '@argus/shared';

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

