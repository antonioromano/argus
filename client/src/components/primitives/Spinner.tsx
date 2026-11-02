import { Loader2 } from 'lucide-react';
import { Icon } from './Icon.js';
import type { IconSize } from './iconSize.js';

interface SpinnerProps {
  size?: IconSize;
  color?: string;
  'aria-label'?: string;
}

/** The one loading glyph — never render Loader2 directly (iconSizing test). */
export function Spinner({ size = 'md', color = 'currentColor', 'aria-label': ariaLabel }: SpinnerProps) {
  return (
    <span role={ariaLabel ? 'img' : undefined} aria-label={ariaLabel} style={{ display: 'inline-flex', flexShrink: 0, animation: 'argus-spin 0.9s linear infinite', color }}>
      <Icon icon={Loader2} size={size} strokeWidth={2} />
    </span>
  );
}
