import type { SessionUsage } from '@argus/shared';

/** Context-% bands for the usage chip: plenty left, getting full, compact soon. */
export type ContextLevel = 'ok' | 'warn' | 'high';

export const CONTEXT_WARN_PCT = 60;
export const CONTEXT_HIGH_PCT = 85;

export function contextLevel(pct: number): ContextLevel {
  if (pct >= CONTEXT_HIGH_PCT) return 'high';
  if (pct >= CONTEXT_WARN_PCT) return 'warn';
  return 'ok';
}

/** 1234 → "1.2k", 4_560_000 → "4.6M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
}

/** $0.004 → "<$0.01", $1.234 → "$1.23", $123.4 → "$123". */
export function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd)}`;
}

/** Tooltip body: the breakdown behind the two numbers on the chip. */
export function describeUsage(u: SessionUsage): string {
  const parts: string[] = [];
  if (u.contextTokens !== undefined) {
    parts.push(
      u.contextWindow
        ? `Context ${formatTokens(u.contextTokens)} of ${formatTokens(u.contextWindow)} (${u.contextPct ?? 0}%)`
        : `Context ${formatTokens(u.contextTokens)}`,
    );
  }
  parts.push(
    `${formatTokens(u.totalTokens)} tokens: ${formatTokens(u.inputTokens)} in, ${formatTokens(u.outputTokens)} out, `
      + `${formatTokens(u.cacheReadTokens)} cache read, ${formatTokens(u.cacheCreationTokens)} cache write`,
  );
  if (u.costUsd !== undefined) {
    parts.push(`≈ ${formatCost(u.costUsd)} at API prices${u.costPartial ? ' (some turns unpriced)' : ''}`);
  } else {
    parts.push('No price for this model');
  }
  if (u.model) parts.push(u.model);
  return parts.join(' · ');
}
