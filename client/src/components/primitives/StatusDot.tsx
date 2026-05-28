import type { SessionStatus } from '@argus/shared';
import { STATUS_PULSE, STATUS_LABELS } from '../../constants/status.js';

interface StatusDotProps {
  status: SessionStatus;
  size?: number;
  /** Force pulse regardless of status default. */
  pulse?: boolean;
  /** Suppress the aria-label when the dot sits next to a label that already announces status. */
  decorative?: boolean;
}

export function StatusDot({ status, size = 8, pulse, decorative }: StatusDotProps) {
  const shouldPulse = pulse ?? STATUS_PULSE[status];
  return (
    <span
      className="argus-status argus-dot"
      data-status={status}
      data-pulse={shouldPulse || undefined}
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : STATUS_LABELS[status]}
      aria-hidden={decorative || undefined}
      style={{ width: size, height: size }}
    />
  );
}
