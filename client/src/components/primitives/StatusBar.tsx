import type { SessionStatus } from '@argus/shared';
import { STATUS_COLORS, STATUS_PULSE, STATUS_MARQUEE } from '../../constants/status.js';

interface StatusBarProps {
  status: SessionStatus;
  height?: number;
  marquee?: boolean;
}

export function StatusBar({ status, height = 3, marquee }: StatusBarProps) {
  const color = STATUS_COLORS[status];
  const pulse = STATUS_PULSE[status];
  const isMarquee = marquee ?? STATUS_MARQUEE[status];
  return (
    <div
      style={{
        position: 'relative',
        height,
        width: '100%',
        background: color,
        overflow: 'hidden',
        animation: pulse ? 'argus-pulse-bar var(--dur-ambient) ease-in-out infinite' : 'none',
      }}
    >
      {isMarquee && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'repeating-linear-gradient(115deg, transparent 0, transparent 4px, rgba(0,0,0,0.25) 4px, rgba(0,0,0,0.25) 8px)',
            animation: 'argus-marquee 1.5s linear infinite',
          }}
        />
      )}
    </div>
  );
}
