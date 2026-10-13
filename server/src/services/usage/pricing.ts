/**
 * Per-model token prices and context windows for the usage meter (F1).
 *
 * The one place prices live. Rates are Anthropic first-party API list prices in
 * USD per million tokens (checked 2026-10-13). A Claude Code subscription is not
 * billed this way, so the meter labels its figure an *estimate* of what the same
 * tokens would cost on the API.
 *
 * Cache writes are priced from the input rate: 1.25× for the 5-minute TTL, 2×
 * for the 1-hour TTL. Cache reads have their own column because several models
 * break the old 0.1× rule (Fable 5.1, Opus 5.5).
 *
 * A model missing from this table is not guessed at: its turns still count
 * toward the token totals and context %, but get no dollar figure.
 */

export interface ModelPrice {
  /** USD per million uncached input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million cache-read tokens. */
  cacheRead: number;
  /** Context window in tokens. */
  contextWindow: number;
  /** Price multiplier for `speed: "fast"` turns. Absent ⇒ fast turns are unpriced. */
  fastMultiplier?: number;
  /** Tiered pricing: a turn whose prompt exceeds `threshold` tokens bills at these rates. */
  longPrompt?: { threshold: number; input: number; output: number; cacheRead: number };
}

const M = 1_000_000;
const K200 = 200_000;
const M1 = 1_000_000;

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, contextWindow: M1 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheRead: 0.25, contextWindow: M1 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, contextWindow: M1 },
  'claude-mythos-5': { input: 10, output: 50, cacheRead: 1, contextWindow: M1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, contextWindow: M1, fastMultiplier: 2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, contextWindow: M1, fastMultiplier: 2 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, contextWindow: M1 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, contextWindow: M1 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, contextWindow: M1 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, contextWindow: K200 },
  'claude-opus-4-1': { input: 15, output: 75, cacheRead: 1.5, contextWindow: K200 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, contextWindow: K200 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, contextWindow: M1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, contextWindow: M1 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, contextWindow: M1 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, contextWindow: K200 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, contextWindow: K200 },
  'claude-3-7-sonnet': { input: 3, output: 15, cacheRead: 0.3, contextWindow: K200 },
  'claude-haiku-5-5': {
    input: 0.1, output: 0.5, cacheRead: 0.01, contextWindow: M1,
    longPrompt: { threshold: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 },
  },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, contextWindow: K200 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, contextWindow: K200 },
};

/**
 * Reduce a transcript's model string to a table key: lowercased, provider
 * prefix (`us.anthropic.`, `anthropic.`), `[1m]` tag, Vertex `@date`, Bedrock
 * `-v1:0` and a trailing `-YYYYMMDD` snapshot date all removed.
 */
export function normalizeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(?:[a-z0-9-]+\.)?anthropic\./, '')
    .replace(/\[[^\]]*\]$/, '')
    .replace(/@.*$/, '')
    .replace(/-v\d+(?::\d+)?$/, '')
    .replace(/-\d{8}$/, '');
}

export function priceFor(model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined;
  return MODEL_PRICES[normalizeModelId(model)];
}

/** One assistant turn's billed usage, as recorded in a transcript. */
export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  /** Cache writes at the 5-minute TTL (includes writes whose TTL was not broken out). */
  cacheWrite5m: number;
  cacheWrite1h: number;
  speed?: string;
}

/**
 * Estimated USD for one turn, or undefined when the model (or its fast-mode
 * rate) is unknown.
 */
export function turnCost(model: string | undefined, u: TurnUsage): number | undefined {
  const p = priceFor(model);
  if (!p) return undefined;
  let mult = 1;
  if (u.speed === 'fast') {
    if (!p.fastMultiplier) return undefined;
    mult = p.fastMultiplier;
  }
  const prompt = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h;
  const rate = p.longPrompt && prompt > p.longPrompt.threshold ? p.longPrompt : p;
  const usd =
    (u.input * rate.input +
      u.output * rate.output +
      u.cacheRead * rate.cacheRead +
      u.cacheWrite5m * rate.input * 1.25 +
      u.cacheWrite1h * rate.input * 2) / M;
  return usd * mult;
}

/**
 * Context window for a model. A transcript turn that already holds more than
 * the table says (e.g. Sonnet 4.5 on the 1M beta) can only mean the larger
 * window is in use, so the observed size bumps it to 1M.
 */
export function contextWindowFor(model: string | undefined, observedTokens: number): number | undefined {
  const p = priceFor(model);
  if (!p) return observedTokens > K200 ? M1 : undefined;
  return observedTokens > p.contextWindow ? Math.max(M1, p.contextWindow) : p.contextWindow;
}
