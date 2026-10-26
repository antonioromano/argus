import {
  DEFAULT_CONFIG,
  USAGE_METER_PART_IDS,
  type AppConfig,
  type PlanUsage,
  type PlanUsageAgent,
  type PlanUsageMap,
  type PlanWindow,
  type SessionUsage,
  type UsageMeterPart,
  type UsageWarnThresholds,
} from '@argus/shared';

/** Chip warning level: below amber, amber, red. */
export type UsageLevel = 'ok' | 'warn' | 'high';

/** What the usage chip needs from config: part order/visibility and thresholds. */
export interface UsageMeterView {
  parts: UsageMeterPart[];
  warnContext: UsageWarnThresholds;
  warnPlan: UsageWarnThresholds;
}

/** Everything a shell header needs to render the chip: the view plus plan usage per agent. */
export interface UsageMeterState extends UsageMeterView {
  plans: PlanUsageMap;
}

export const DEFAULT_USAGE_PARTS = DEFAULT_CONFIG.usageMeterParts!;
export const DEFAULT_WARN_CONTEXT = DEFAULT_CONFIG.usageWarnContext!;
export const DEFAULT_WARN_PLAN = DEFAULT_CONFIG.usageWarnPlan!;

/** Every part exactly once, in the saved order; anything malformed falls back to the default. */
export function normalizeParts(parts: readonly UsageMeterPart[] | undefined): UsageMeterPart[] {
  if (!Array.isArray(parts)) return DEFAULT_USAGE_PARTS.map((p) => ({ ...p }));
  const seen = new Set<string>();
  const out: UsageMeterPart[] = [];
  for (const p of parts) {
    if (!p || !(USAGE_METER_PART_IDS as readonly string[]).includes(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, on: p.on === true });
  }
  for (const d of DEFAULT_USAGE_PARTS) if (!seen.has(d.id)) out.push({ ...d });
  return out;
}

function normalizeWarn(t: UsageWarnThresholds | undefined, fallback: UsageWarnThresholds): UsageWarnThresholds {
  if (!t || !(t.amber >= 5 && t.red <= 99 && t.red > t.amber)) return fallback;
  return t;
}

/** The chip's view of config. Null when the meter is switched off. */
export function usageMeterView(config: AppConfig | null | undefined): UsageMeterView | null {
  if (config?.showUsageMeter === false) return null;
  return {
    parts: normalizeParts(config?.usageMeterParts),
    warnContext: normalizeWarn(config?.usageWarnContext, DEFAULT_WARN_CONTEXT),
    warnPlan: normalizeWarn(config?.usageWarnPlan, DEFAULT_WARN_PLAN),
  };
}

/** Agents that report usage. Gemini (and custom agents) report none: no chip. */
export function meterAgent(agentType: string): PlanUsageAgent | null {
  return agentType === 'claude' || agentType === 'codex' ? agentType : null;
}

/** The plan usage a shell of `agentType` shows (its agent account's). */
export function planFor(plans: PlanUsageMap, agentType: string): PlanUsage | undefined {
  const a = meterAgent(agentType);
  return a ? plans[a] : undefined;
}

export function usageLevel(pct: number | undefined, t: UsageWarnThresholds): UsageLevel {
  if (pct === undefined) return 'ok';
  if (pct >= t.red) return 'high';
  if (pct >= t.amber) return 'warn';
  return 'ok';
}

const RANK: Record<UsageLevel, number> = { ok: 0, warn: 1, high: 2 };
export function worstLevel(...levels: UsageLevel[]): UsageLevel {
  return levels.reduce<UsageLevel>((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok');
}

/** A window past its reset time reads as reset (0%) until a fresh value arrives. */
export function effectiveWindow(w: PlanWindow | undefined, now: number): PlanWindow | undefined {
  if (!w) return undefined;
  if (w.reset || (w.resetsAt !== undefined && w.resetsAt <= now)) {
    return { usedPct: 0, windowMinutes: w.windowMinutes, reset: true };
  }
  return w;
}

/** 1234 → "1.2k", 4_560_000 → "4.6M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

/** Time until a reset: "45m", "2h19m", "6d", "<1m". */
export function formatResetIn(ms: number): string {
  if (ms < 60_000) return '<1m';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h${String(min % 60).padStart(2, '0')}m`;
  return `${Math.round(h / 24)}d`;
}

/** "5-hour", "7-day", "30-day", or "" when unknown. */
export function windowName(minutes: number | undefined): string {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes}-minute`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}-hour`;
  return `${Math.round(minutes / 1440)}-day`;
}

const pct = (n: number) => `${Math.round(n)}%`;

/** "claude-opus-5-5" → "opus-5-5", "gpt-5.5" stays. */
export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

/** Label of a plan window: "Session" (hours), "Weekly", "30-day", "Plan" when unknown. */
export function planWindowLabel(minutes: number | undefined): string {
  if (!minutes) return 'Plan';
  if (minutes < 48 * 60) return 'Session';
  if (minutes === 7 * 1440) return 'Weekly';
  return windowName(minutes);
}

/** Compact key of a plan window for tight spots: "5h", "7d", "plan" when unknown. */
export function planWindowKey(minutes: number | undefined): string {
  if (!minutes) return 'plan';
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

/**
 * When a plan window resets, spelled out: "Resets in 3 hr 13 min" within a
 * day, "Resets Sat 9:00 PM" further out (in the viewer's locale).
 */
export function formatResetPhrase(resetsAt: number, now: number, locale?: string): string {
  const ms = resetsAt - now;
  if (ms >= 24 * 3_600_000) {
    const at = new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(resetsAt);
    return `Resets ${at}`;
  }
  if (ms < 60_000) return 'Resets in <1 min';
  const min = Math.floor(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `Resets in ${m} min`;
  return m ? `Resets in ${h} hr ${m} min` : `Resets in ${h} hr`;
}

/** One row of the hover breakdown. */
export interface UsageRow {
  label: string;
  value: string;
}

/**
 * The hover breakdown: context, both plan windows with their resets, tokens,
 * model and the warn thresholds. Same rows wherever the chip renders.
 */
export function describeUsage(
  usage: SessionUsage | undefined,
  plan: PlanUsage | undefined,
  view: UsageMeterView,
  now: number,
): UsageRow[] {
  const rows: UsageRow[] = [];
  if (usage?.contextTokens !== undefined) {
    rows.push({
      label: 'Context',
      value: usage.contextWindow
        ? `${formatTokens(usage.contextTokens)} of ${formatTokens(usage.contextWindow)} (${pct(usage.contextPct ?? 0)})`
        : formatTokens(usage.contextTokens),
    });
  }
  for (const [label, w0] of [['Plan usage', plan?.primary], ['Plan usage', plan?.secondary]] as const) {
    const w = effectiveWindow(w0, now);
    if (!w) continue;
    const name = windowName(w.windowMinutes);
    const of = name ? ` of the ${name} window` : '';
    const reset = w.reset
      ? ' · reset, waiting for a fresh reading'
      : w.resetsAt !== undefined ? ` · resets in ${formatResetIn(w.resetsAt - now)}` : '';
    rows.push({ label, value: `${pct(w.usedPct)}${of}${reset}` });
  }
  if (usage) {
    rows.push({
      label: 'Tokens',
      value: `${formatTokens(usage.totalTokens)}: ${formatTokens(usage.inputTokens)} in, ${formatTokens(usage.outputTokens)} out, `
        + `${formatTokens(usage.cacheReadTokens)} cache read, ${formatTokens(usage.cacheCreationTokens)} cache write`,
    });
    if (usage.model) rows.push({ label: 'Model', value: usage.model });
  }
  rows.push({
    label: 'Warns at',
    value: `context ${view.warnContext.amber}/${view.warnContext.red}% · plan ${view.warnPlan.amber}/${view.warnPlan.red}%`,
  });
  return rows;
}
