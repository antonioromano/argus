import type { CSSProperties } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { iconSize, type IconSize } from './iconSize.js';

interface IconProps extends Omit<LucideProps, 'size' | 'ref'> {
  icon: LucideIcon;
  size?: IconSize;
}

/** The one place lucide icons get a size. Width/height go through CSS so the
 *  icon tracks the interface font instead of a hardcoded pixel box — the
 *  `iconSizing` test keeps every other component off raw lucide sizes. */
export function Icon({ icon: Glyph, size = 'md', style, ...rest }: IconProps) {
  const dim = iconSize(size);
  const sized: CSSProperties = { width: dim, height: dim, ...style };
  return <Glyph {...rest} style={sized} />;
}
