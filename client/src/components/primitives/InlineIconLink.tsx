import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Tooltip } from './Tooltip.js';

interface InlineIconLinkProps {
  icon: LucideIcon;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  size?: number;
  hoverColor?: string;
  opacity?: number;
}

export function InlineIconLink({
  icon: Icon,
  label,
  onClick,
  size = 13,
  hoverColor = 'var(--accent)',
  opacity = 1,
}: InlineIconLinkProps) {
  return (
    <Tooltip content={label} position="top">
      <button
        aria-label={label}
        className="argus-inline-icon"
        onClick={(e) => { e.stopPropagation(); onClick(e); }}
        style={{
          ['--hover-color' as string]: hoverColor,
          ['--rest-opacity' as string]: String(opacity),
        } as CSSProperties}
      >
        <Icon size={size} strokeWidth={1.6} />
      </button>
    </Tooltip>
  );
}
