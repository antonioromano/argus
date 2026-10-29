// Session identity helpers (plan 009): the emoji check (mirroring the server's
// validateIdentity, so the field refuses what the PATCH would), colour-key
// resolution and the edge-bar props, and the editor's curated emoji.
import type { CSSProperties } from 'react';
import { SESSION_EMOJI_MAX } from '@argus/shared';
import { GROUP_COLORS } from '../constants/groupColors.js';

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** True when `value` is exactly one emoji grapheme (ZWJ sequences and flags included). */
export function isSingleEmoji(value: string): boolean {
  if (!value || value.length > SESSION_EMOJI_MAX) return false;
  return [...segmenter.segment(value)].length === 1 && PICTOGRAPHIC.test(value);
}

/** The theme-resolved hex of an identity colour key, or undefined when unset or unknown. */
export function resolveIdentityColor(color: string | undefined, isDark: boolean): string | undefined {
  if (!color) return undefined;
  const c = GROUP_COLORS.find((g) => g.key === color);
  return c ? (isDark ? c.dark : c.light) : undefined;
}

/**
 * Props that put the identity edge bar on an element: spread onto the element
 * and merge `style` with its own. Empty when the session has no colour, so the
 * DOM stays exactly as it was before identities existed.
 */
export function identityEdgeProps(
  color: string | undefined,
  isDark: boolean,
): { 'data-identity-edge'?: string; style?: CSSProperties } {
  const hex = resolveIdentityColor(color, isDark);
  if (!hex) return {};
  return { 'data-identity-edge': color, style: { ['--identity-edge' as string]: hex } as CSSProperties };
}

/** 24 picks that read at 12px and mean something at a glance. Anything else
 *  goes in the field (⌃⌘Space opens the macOS picker there). */
export const CURATED_EMOJI = [
  '🦊', '🐙', '🐝', '🦄', '🐢', '🐳',
  '🚀', '🔥', '⚡', '🌱', '🌊', '❄️',
  '🧪', '🐛', '🔧', '📦', '🎨', '📝',
  '🔒', '💡', '🎯', '🧭', '🏗️', '⭐',
] as const;
