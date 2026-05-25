import type { SessionStatus } from '@argus/shared';
import { STATUS_COLORS } from '../../constants/status.js';

interface StatusDotProps {
  status: SessionStatus;
  /** Animate a pulse ring — use for 'running' status. */
  pulse?: boolean;
  size?: number;
}

export function StatusDot({ status, pulse, size = 8 }: StatusDotProps) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.idle;

  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        position: 'relative',
        boxShadow: status !== 'exited' ? `0 0 6px ${color}` : undefined,
        animation: (pulse && (status === 'running' || status === 'waiting')) ? 'status-pulse 1.8s ease-in-out infinite' : undefined,
      }}
    />
  );
}
