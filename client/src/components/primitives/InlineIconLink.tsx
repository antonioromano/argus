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

/**
 * Tiny icon button meant to sit inline within text rows (file tree nodes,
 * diff file headers, untracked-file rows, etc.).  Renders at the given
 * `size` (default 13) with muted colour that transitions to `hoverColor`
 * (default accent) on hover.  Wrapped in a Tooltip for discoverability.
 */
export function InlineIconLink({
  icon: Icon,
  label,
  onClick,
  size = 13,
  hoverColor = 'var(--color-accent)',
  opacity,
}: InlineIconLinkProps) {
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
          color: 'var(--color-text-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          flexShrink: 0,
          borderRadius: '3px',
          opacity: opacity ?? 1,
          transition: 'color var(--transition-fast), opacity var(--transition-fast)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = hoverColor; e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.opacity = String(opacity ?? 1); }}
      >
        <Icon size={size} strokeWidth={1.75} />
      </button>
    </Tooltip>
  );
}
