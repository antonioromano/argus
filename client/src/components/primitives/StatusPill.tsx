import type { SessionStatus } from '@argus/shared';
import { STATUS_LABELS } from '../../constants/status.js';
import { StatusDot } from './StatusDot.js';

interface StatusPillProps {
  status: SessionStatus;
  size?: 'sm' | 'md';
}

export function StatusPill({ status, size = 'md' }: StatusPillProps) {
  return (
    <span className="argus-status argus-pill" data-status={status} data-size={size}>
      <StatusDot status={status} size={6} decorative />
      <span className="argus-pill-label">{STATUS_LABELS[status]}</span>
    </span>
  );
}
