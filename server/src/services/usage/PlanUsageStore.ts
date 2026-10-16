import type { PlanUsage, PlanUsageAgent, PlanUsageMap, PlanWindow } from '@argus/shared';

/**
 * Plan (subscription) usage per agent kind (claude, codex).
 *
 * Plan usage belongs to the account, not to a shell: every Claude shell shows
 * the latest Claude reading, every Codex shell the latest Codex one. Readings
 * arrive from any session (Claude's status line, Codex's rollout logs); an
 * older reading never replaces a newer one, so tailing an old Codex log cannot
 * roll the meter back.
 */

const FIVE_HOURS_MIN = 300;
const SEVEN_DAYS_MIN = 7 * 24 * 60;

/**
 * A window whose reset time has passed is shown as reset (0%) until a fresh
 * reading arrives. The client applies the same rule as time moves on.
 */
export function effectiveWindow(w: PlanWindow | undefined, now: number): PlanWindow | undefined {
  if (!w) return undefined;
  if (w.resetsAt !== undefined && w.resetsAt <= now) {
    return { usedPct: 0, windowMinutes: w.windowMinutes, reset: true };
  }
  return w;
}

export function effectivePlan(p: PlanUsage, now: number): PlanUsage {
  const out: PlanUsage = { observedAt: p.observedAt };
  const primary = effectiveWindow(p.primary, now);
  const secondary = effectiveWindow(p.secondary, now);
  if (primary) out.primary = primary;
  if (secondary) out.secondary = secondary;
  return out;
}

const pct = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(100, Math.round(v * 10) / 10) : undefined;

/** Epoch seconds → ms, accepting only a plausible time (2001..2286). */
export function epochSecondsToMs(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1e9 || v > 1e10) return undefined;
  return Math.round(v * 1000);
}

function claudeWindow(raw: unknown, windowMinutes: number): PlanWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { used_percentage?: unknown; resets_at?: unknown };
  const usedPct = pct(r.used_percentage);
  if (usedPct === undefined) return undefined;
  const w: PlanWindow = { usedPct, windowMinutes };
  const resetsAt = epochSecondsToMs(r.resets_at);
  if (resetsAt !== undefined) w.resetsAt = resetsAt;
  return w;
}

/**
 * Claude Code's status line `rate_limits` object: `five_hour` and `seven_day`,
 * each `{ used_percentage: 0..100, resets_at: epoch seconds }`, either one may
 * be absent. Null when neither window is usable.
 */
export function parseClaudeRateLimits(raw: unknown, observedAt: number): PlanUsage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { five_hour?: unknown; seven_day?: unknown };
  const primary = claudeWindow(r.five_hour, FIVE_HOURS_MIN);
  const secondary = claudeWindow(r.seven_day, SEVEN_DAYS_MIN);
  if (!primary && !secondary) return null;
  const out: PlanUsage = { observedAt };
  if (primary) out.primary = primary;
  if (secondary) out.secondary = secondary;
  return out;
}

const sameWindow = (a?: PlanWindow, b?: PlanWindow): boolean =>
  a?.usedPct === b?.usedPct && a?.resetsAt === b?.resetsAt && a?.windowMinutes === b?.windowMinutes && a?.reset === b?.reset;

export class PlanUsageStore {
  private plans = new Map<PlanUsageAgent, PlanUsage>();

  constructor(
    private onChange: (agent: PlanUsageAgent, plan: PlanUsage) => void = () => {},
    private now: () => number = Date.now,
  ) {}

  /**
   * Record a reading. A window the reading leaves out keeps its previous value
   * (Claude omits a window once it resets; the reset rule then shows it as 0%).
   * Returns true when the stored plan changed.
   */
  update(agent: PlanUsageAgent, reading: PlanUsage): boolean {
    const cur = this.plans.get(agent);
    if (cur && reading.observedAt < cur.observedAt) return false;
    const next: PlanUsage = { observedAt: reading.observedAt };
    const primary = reading.primary ?? cur?.primary;
    const secondary = reading.secondary ?? cur?.secondary;
    if (primary) next.primary = primary;
    if (secondary) next.secondary = secondary;
    this.plans.set(agent, next);
    if (cur && sameWindow(cur.primary, next.primary) && sameWindow(cur.secondary, next.secondary)) return false;
    this.onChange(agent, effectivePlan(next, this.now()));
    return true;
  }

  get(agent: PlanUsageAgent): PlanUsage | undefined {
    const p = this.plans.get(agent);
    return p ? effectivePlan(p, this.now()) : undefined;
  }

  all(): PlanUsageMap {
    const out: PlanUsageMap = {};
    for (const agent of this.plans.keys()) out[agent] = this.get(agent);
    return out;
  }

  clear(): void {
    this.plans.clear();
  }
}
