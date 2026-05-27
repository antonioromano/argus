import type { SessionStatus } from '@argus/shared';
import { STATUS_COLORS, STATUS_PULSE, STATUS_LABELS } from '../../constants/status.js';

interface StatusDotProps {
  status: SessionStatus;
  size?: number;
  /** Force pulse regardless of status default. */
  pulse?: boolean;
  /** Suppress the aria-label when the dot sits next to a label that already announces status. */
  decorative?: boolean;
}

export function StatusDot({ status, size = 8, pulse, decorative }: StatusDotProps) {
  const color = STATUS_COLORS[status];
  const shouldPulse = pulse ?? STATUS_PULSE[status];
  return (
    <span
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : STATUS_LABELS[status]}
      aria-hidden={decorative || undefined}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: shouldPulse ? `0 0 8px ${color}` : 'none',
        animation: shouldPulse ? 'argus-pulse-dot var(--dur-ambient) ease-in-out infinite' : undefined,
        flexShrink: 0,
      }}
    />
  );
}
