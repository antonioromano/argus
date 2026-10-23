/** Named icon sizes — each maps to a `--icon-*` token in tokens.css, which
 *  scales with the Interface font-size setting (`--ui-scale`). */
export type IconToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** A token, or a design size in px *at the default interface font* (14px).
 *  Numbers are scaled too, so `size={13}` renders at 13px on Medium and grows
 *  with the font — never a fixed pixel size. */
export type IconSize = IconToken | number;

const TOKEN_VAR: Record<IconToken, string> = {
  xs: 'var(--icon-xs)',
  sm: 'var(--icon-sm)',
  md: 'var(--icon-size)',
  lg: 'var(--icon-lg)',
  xl: 'var(--icon-xl)',
};

/** A length that scales with the interface font: `px` is the size at the
 *  default (Medium) setting. Use it for icon-sized boxes and control heights. */
export function scaledPx(px: number): string {
  return `calc(${px}px * var(--ui-scale, 1))`;
}

/** CSS length for an icon size — tokens resolve to their var, numbers scale. */
export function iconSize(size: IconSize): string {
  return typeof size === 'number' ? scaledPx(size) : TOKEN_VAR[size];
}
