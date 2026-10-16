/**
 * Context window per Claude model, for the usage meter's context % (F1).
 *
 * A model missing from this table is not guessed at: its turns still count
 * toward the token totals, but get no context % unless a turn already holds
 * more than 200k tokens (then only the 1M window fits).
 */

const K200 = 200_000;
const M1 = 1_000_000;

export const MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  'claude-fable-5-1': M1,
  'claude-mythos-5-1': M1,
  'claude-fable-5': M1,
  'claude-mythos-5': M1,
  'claude-opus-5-5': M1,
  'claude-opus-5': M1,
  'claude-opus-4-8': M1,
  'claude-opus-4-7': M1,
  'claude-opus-4-6': M1,
  'claude-opus-4-5': K200,
  'claude-opus-4-1': K200,
  'claude-opus-4': K200,
  'claude-sonnet-5-5': M1,
  'claude-sonnet-5': M1,
  'claude-sonnet-4-6': M1,
  'claude-sonnet-4-5': K200,
  'claude-sonnet-4': K200,
  'claude-3-7-sonnet': K200,
  'claude-haiku-5-5': M1,
  'claude-haiku-4-5': K200,
  'claude-3-5-haiku': K200,
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

/**
 * Context window for a model. A transcript turn that already holds more than
 * the table says (e.g. Sonnet 4.5 on the 1M beta) can only mean the larger
 * window is in use, so the observed size bumps it to 1M.
 */
export function contextWindowFor(model: string | undefined, observedTokens: number): number | undefined {
  const win = model ? MODEL_CONTEXT_WINDOWS[normalizeModelId(model)] : undefined;
  if (!win) return observedTokens > K200 ? M1 : undefined;
  return observedTokens > win ? Math.max(M1, win) : win;
}
