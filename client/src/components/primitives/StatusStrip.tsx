import type { DisplayStatus } from '../../utils/displayStatus.js';
import { STATUS_MARQUEE } from '../../constants/status.js';

interface StatusStripProps {
  status: DisplayStatus;
  height?: number;
  marquee?: boolean;
}

export function StatusStrip({ status, height = 3, marquee }: StatusStripProps) {
  const isMarquee = marquee ?? STATUS_MARQUEE[status];
  return (
    <div className="argus-status argus-bar" data-status={status} style={{ height }}>
      {isMarquee && <div className="argus-bar-marquee" />}
    </div>
  );
}
