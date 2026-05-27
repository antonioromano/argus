import type { LucideIcon } from 'lucide-react';
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
  opacity,
}: InlineIconLinkProps) {
  const mutedColor = 'var(--fg-3)';
  return (
    <Tooltip content={label} position="top">
      <button
        aria-label={label}
        onClick={(e) => { e.stopPropagation(); onClick(e); }}
        style={{
          background: 'none',
          border: 'none',
          padding: '0 2px',
          cursor: 'pointer',
          color: mutedColor,
          display: 'inline-flex',
          alignItems: 'center',
          flexShrink: 0,
          borderRadius: 'var(--r-1)',
          opacity: opacity ?? 1,
          transition: 'color var(--dur-fast), opacity var(--dur-fast)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = hoverColor; e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = mutedColor; e.currentTarget.style.opacity = String(opacity ?? 1); }}
      >
        <Icon size={size} strokeWidth={1.6} />
      </button>
    </Tooltip>
  );
}
