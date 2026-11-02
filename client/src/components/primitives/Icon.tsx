import type { CSSProperties } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { iconSize, type IconSize } from './iconSize.js';

interface IconProps extends Omit<LucideProps, 'size' | 'ref'> {
  icon: LucideIcon;
  size?: IconSize;
}

/** The one place lucide icons get a size. Width/height go through CSS so the
 *  icon tracks the interface font instead of a hardcoded pixel box — the
 *  `iconSizing` test keeps every other component off raw lucide sizes.
 *
 *  Two stroke weights: the `--icon-stroke` token by default, and
 *  `strokeWidth={2}` for emphasis (tiny glyphs, checkbox ticks). */
export function Icon({ icon: Glyph, size = 'md', style, ...rest }: IconProps) {
  const dim = iconSize(size);
  const stroke: CSSProperties = rest.strokeWidth === undefined ? { strokeWidth: 'var(--icon-stroke)' } : {};
  const sized: CSSProperties = { width: dim, height: dim, ...stroke, ...style };
  return <Glyph {...rest} style={sized} />;
}
