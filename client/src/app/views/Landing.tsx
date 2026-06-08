import { Plus, Play, RotateCcw } from 'lucide-react';
import { Button } from '../../components/primitives/index.js';

interface LandingProps {
  /** 'empty' — no shells exist. 'all-minimized' — shells exist but every tile is minimized. */
  mode: 'empty' | 'all-minimized';
  /** Count of minimized shells (0 when empty). */
  minimizedCount: number;
  onCreate: () => void;
  onRestoreAll: () => void;
}

/**
 * Ambient mission-control landing shown in the mosaic when nothing is on the grid —
 * either no shells at all, or all shells minimized (chips still pinned above). A breathing
 * amber glow + pulsing ring echo the "waiting" status; one primary action gets you moving.
 */
export function Landing({ mode, minimizedCount, onCreate, onRestoreAll }: LandingProps) {
  const minimized = mode === 'all-minimized';
  const title = minimized ? 'Nothing on the grid' : 'Ready when you are';
  const hint = minimized
    ? `Bring your ${minimizedCount} ${minimizedCount === 1 ? 'shell' : 'shells'} back — or start another.`
    : 'No shells running. Spin one up and Argus takes it from there.';
  const CoreIcon = minimized ? RotateCcw : Play;

  return (
    <div className="argus-landing">
      <div className="argus-landing-glow" aria-hidden />
      <div className="argus-landing-inner">
        <div className="argus-landing-ring" aria-hidden>
          <div className="argus-landing-core">
            <CoreIcon size={28} strokeWidth={1.8} />
          </div>
        </div>
        <h2 className="argus-landing-title">{title}</h2>
        <p className="argus-landing-hint">{hint}</p>
        <div className="argus-landing-cta">
          {minimized ? (
            <>
              <Button variant="primary" size="lg" icon={RotateCcw} onClick={onRestoreAll}>
                Restore all ({minimizedCount})
              </Button>
              <Button variant="ghost" size="lg" icon={Plus} onClick={onCreate}>
                New shell
              </Button>
            </>
          ) : (
            <Button variant="primary" size="lg" icon={Plus} onClick={onCreate}>
              New shell
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
