import type { SetSessionIdentityRequest } from '@argus/shared';

/**
 * Colour keys a session's identity may carry. Duplicated from
 * `SESSION_COLOR_KEYS` in `shared/src/types.ts` rather than imported: server
 * code may only `import type` from `@argus/shared` (a value import crashes the
 * packaged app — see constants/session.ts). `check:deps` pins the two copies.
 */
export const SESSION_COLOR_KEYS = {
  blue: true,
  green: true,
  purple: true,
  amber: true,
  pink: true,
  teal: true,
  grey: true,
} as const;

/** Longest accepted identity emoji, in UTF-16 units. Mirrors the shared constant. */
export const SESSION_EMOJI_MAX = 16;

export interface SessionIdentityPatch {
  color?: string | null;
  emoji?: string | null;
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** True when `value` is exactly one emoji grapheme (ZWJ sequences and flags included). */
export function isSingleEmoji(value: string): boolean {
  if (!value || value.length > SESSION_EMOJI_MAX) return false;
  const graphemes = [...segmenter.segment(value)];
  return graphemes.length === 1 && PICTOGRAPHIC.test(value);
}

/**
 * Validate an identity request. Fields left out stay as they are; `null` (or an
 * empty string) clears. Returns the normalized patch or the reason it was refused.
 */
export function validateIdentity(req: unknown): SessionIdentityPatch | { error: string } {
  if (!req || typeof req !== 'object' || Array.isArray(req)) return { error: 'body must be an object' };
  const { color, emoji } = req as SetSessionIdentityRequest;
  const patch: SessionIdentityPatch = {};

  if (color !== undefined) {
    if (color === null || color === '') patch.color = null;
    else if (typeof color === 'string' && Object.hasOwn(SESSION_COLOR_KEYS, color)) patch.color = color;
    else return { error: 'color must be one of ' + Object.keys(SESSION_COLOR_KEYS).join(', ') };
  }

  if (emoji !== undefined) {
    if (emoji === null || emoji === '') patch.emoji = null;
    else if (typeof emoji === 'string' && isSingleEmoji(emoji.trim())) patch.emoji = emoji.trim();
    else return { error: 'emoji must be a single emoji' };
  }

  if (patch.color === undefined && patch.emoji === undefined) return { error: 'color or emoji is required' };
  return patch;
}
