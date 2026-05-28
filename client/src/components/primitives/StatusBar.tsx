import type { SessionStatus } from '@argus/shared';
import { STATUS_MARQUEE } from '../../constants/status.js';

interface StatusBarProps {
  status: SessionStatus;
  height?: number;
  marquee?: boolean;
}

export function StatusBar({ status, height = 3, marquee }: StatusBarProps) {
  const isMarquee = marquee ?? STATUS_MARQUEE[status];
  return (
    <div className="argus-status argus-bar" data-status={status} style={{ height }}>
      {isMarquee && <div className="argus-bar-marquee" />}
    </div>
  );
}
