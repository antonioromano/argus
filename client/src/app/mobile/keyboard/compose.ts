/** Max compose-field height (~5 rows) before it scrolls internally. */
export const COMPOSE_MAX_H = 132;

/**
 * Resize the compose field to its content, capped at COMPOSE_MAX_H.
 *
 * Lives outside ComposeBar because text can arrive without an input event — the
 * toolbar's newline key sets React state directly, and assigning `value` grows
 * nothing on its own — and a component module may only export components.
 */
export function autoGrowCompose(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, COMPOSE_MAX_H)}px`;
}

/**
 * Insert a newline into the composed message at the caret, replacing whatever is
 * selected, and report where the caret lands.
 *
 * The compose field submits on Enter and a software keyboard has no
 * Shift+Enter, so this is the only route to a multi-line message from a phone —
 * and `composeSubmit` exists specifically to translate those newlines for the
 * agent. A missing or out-of-range caret (readOnly field, stale selection after
 * an external edit) falls back to the end instead of corrupting the text.
 */
export function insertNewlineAt(
  text: string,
  start: number | null,
  end: number | null,
): { text: string; caret: number } {
  const at = clampCaret(start, text.length);
  const to = clampCaret(end ?? at, text.length);
  const from = Math.min(at, to);
  const until = Math.max(at, to);
  return { text: `${text.slice(0, from)}\n${text.slice(until)}`, caret: from + 1 };
}

function clampCaret(n: number | null, max: number): number {
  if (n == null || !Number.isFinite(n) || n < 0) return max;
  return Math.min(n, max);
}
