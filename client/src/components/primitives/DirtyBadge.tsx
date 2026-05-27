import { GitBranch } from 'lucide-react';
import { Tooltip } from './Tooltip.js';

interface DirtyBadgeProps {
  size?: 'sm' | 'md';
  onClick?: (e: React.MouseEvent) => void;
}

export function DirtyBadge({ size = 'md', onClick }: DirtyBadgeProps) {
  const px = size === 'sm' ? 12 : 14;
  return (
    <Tooltip content="Unstaged / uncommitted changes">
      <span
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(e); } : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          color: 'var(--dirty)',
          cursor: onClick ? 'pointer' : 'default',
        }}
      >
        <GitBranch size={px} strokeWidth={1.8} />
      </span>
    </Tooltip>
  );
}
