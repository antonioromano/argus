import type { SessionStatus } from '@argus/shared';
import { STATUS_COLORS, STATUS_BG_COLORS, STATUS_LABELS } from '../../constants/status.js';
import { StatusDot } from './StatusDot.js';

interface StatusPillProps {
  status: SessionStatus;
  size?: 'sm' | 'md';
}

export function StatusPill({ status, size = 'md' }: StatusPillProps) {
  const color = STATUS_COLORS[status];
  const bg = STATUS_BG_COLORS[status];
  const label = STATUS_LABELS[status];
  const padding = size === 'sm' ? '2px var(--s-2)' : '3px var(--s-2)';
  const fontSize = size === 'sm' ? 'var(--t-micro)' : 'var(--t-tiny)';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding,
        background: bg,
        color,
        fontFamily: 'var(--font-mono)',
        fontSize,
        letterSpacing: 'var(--tracking-eye)',
        border: `1px solid ${color}33`,
        borderRadius: 'var(--r-1)',
        lineHeight: 1,
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      <StatusDot status={status} size={6} decorative />
      {label}
    </span>
  );
}
