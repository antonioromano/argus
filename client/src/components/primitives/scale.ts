/**
 * The locked design scales as types (plan 005). Layout primitives take these
 * instead of raw numbers so an off-scale value is a compile error, and the
 * `argus/no-raw-style-scale` lint rule points raw literals here.
 *
 * Every value resolves to a token in tokens/tokens.css — this file holds names,
 * never pixel values.
 */

/** Spacing steps: `--s-0` … `--s-7`, plus the 1px hairline and the two
 *  half-steps (2px, 6px) sanctioned for icon↔label gaps. */
export const SPACE_TOKENS = [0, 'px', 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7] as const;
export type SpaceToken = (typeof SPACE_TOKENS)[number];

/** Suffix of the token name and of the `ds-gap-*` class: 1.5 → '1-5'. */
export function spaceSuffix(t: SpaceToken): string {
  return String(t).replace('.', '-');
}

/** CSS value for a spacing step: `space(1.5)` → `'var(--s-1-5)'`. */
export function space(t: SpaceToken): string {
  return t === 0 ? '0' : `var(--s-${spaceSuffix(t)})`;
}

/** The six type roles. */
export const TEXT_SIZES = ['eyebrow', 'caption', 'small', 'body', 'title', 'display'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** CSS value for a type role: `textSize('caption')` → `'var(--t-caption)'`. */
export function textSize(s: TextSize): string {
  return `var(--t-${s})`;
}

/** Text tones and the colour token each resolves to. */
export const TEXT_TONES = {
  default: 'var(--fg-1)',
  muted: 'var(--fg-2)',
  faint: 'var(--fg-3)',
  accent: 'var(--accent)',
  danger: 'var(--danger)',
  warn: 'var(--warn)',
} as const;
export type TextTone = keyof typeof TEXT_TONES;
