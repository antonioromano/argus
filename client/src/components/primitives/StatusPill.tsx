import type { SessionStatus } from '@argus/shared';
import { STATUS_COLORS, STATUS_LABELS } from '../../constants/status.js';

interface StatusPillProps {
  status: SessionStatus;
}

const BG_COLORS: Record<SessionStatus, string> = {
  waiting: 'rgba(245, 158, 11, 0.15)',
  running: 'rgba(174, 198, 255, 0.15)',
  idle:    'rgba(165, 213, 112, 0.15)',
  exited:  'rgba(156, 163, 175, 0.12)',
};

export function StatusPill({ status }: StatusPillProps) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.idle;
  const bg = BG_COLORS[status] ?? BG_COLORS.idle;
  const label = STATUS_LABELS[status] ?? STATUS_LABELS.idle;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        background: bg,
        color,
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        lineHeight: 1,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          boxShadow: status !== 'exited' ? `0 0 4px ${color}` : undefined,
        }}
      />
      {label}
    </span>
  );
}
