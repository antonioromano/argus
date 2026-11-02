import { contrastRatio, parseColor } from '../tokens/contrast.js';
import { PAINT_ACCENT_SURFACES, type ThemeName } from '../tokens/paint.js';

/** WCAG 1.4.11: a focus ring is a UI boundary, 3:1 against what it sits on. */
const MIN_RATIO = 3;

/**
 * The system accent to use for focus rings, selection and native controls, or
 * null to keep the brand accent: a system colour that cannot clear 3:1 on the
 * panel (--bg-1) and card (--bg-2) of the current theme is not used.
 */
export function pickFocusAccent(sys: string | null, theme: ThemeName): string | null {
  if (!sys || !/^#[0-9a-f]{6}$/i.test(sys)) return null;
  const fg = parseColor(sys);
  const { panel, card } = PAINT_ACCENT_SURFACES[theme];
  const ok = [panel, card].every((s) => contrastRatio(fg, parseColor(s)) >= MIN_RATIO);
  return ok ? sys : null;
}
