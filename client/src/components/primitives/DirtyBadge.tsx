import { GitBranch } from 'lucide-react';
import { Tooltip } from './Tooltip.js';

interface DirtyBadgeProps {
  size?: 'sm' | 'md';
  onClick?: (e: React.MouseEvent) => void;
}

export function DirtyBadge({ size = 'md', onClick }: DirtyBadgeProps) {
  const px = size === 'sm' ? 12 : 14;
  const interactive = !!onClick;
  return (
    <Tooltip content="Unstaged / uncommitted changes">
      <span
        role={interactive ? 'button' : 'img'}
        aria-label={interactive ? 'View unstaged / uncommitted changes' : 'Has unstaged / uncommitted changes'}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(e); } : undefined}
        onKeyDown={onClick ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClick(e as unknown as React.MouseEvent); }
        } : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: 'var(--dirty)',
          cursor: interactive ? 'pointer' : 'default',
        }}
      >
        <GitBranch size={px} strokeWidth={1.8} />
      </span>
    </Tooltip>
  );
}
