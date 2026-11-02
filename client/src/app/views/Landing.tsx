import { Plus, Play, RotateCcw, X } from 'lucide-react';
import { Button, Icon } from '../../components/primitives/index.js';

interface LandingProps {
  /** 'empty' — no shells exist. 'all-minimized' — shells exist but every tile is minimized. */
  mode: 'empty' | 'all-minimized';
  /** Count of minimized shells (0 when empty). */
  minimizedCount: number;
  onCreate: () => void;
  onRestoreAll: () => void;
  /** One quiet "Try session templates (beta)" line under the CTA (empty mode only). */
  promo?: LandingPromo;
}

export interface LandingPromo {
  onTry: () => void;
  onDismiss: () => void;
}

/**
 * Ambient mission-control landing shown in the mosaic when nothing is on the grid —
 * either no shells at all, or all shells minimized (chips still pinned above). A breathing
 * amber glow + pulsing ring echo the "waiting" status; one primary action gets you moving.
 */
export function Landing({ mode, minimizedCount, onCreate, onRestoreAll, promo }: LandingProps) {
  const minimized = mode === 'all-minimized';
  const title = minimized ? 'Nothing on the grid' : 'Ready when you are';
  const hint = minimized
    ? `Bring your ${minimizedCount} ${minimizedCount === 1 ? 'session' : 'sessions'} back — or start another.`
    : 'No sessions running. Start one and Argus takes it from there.';
  const CoreIcon = minimized ? RotateCcw : Play;

  return (
    <div className="argus-landing">
      <div className="argus-landing-glow" aria-hidden />
      <div className="argus-landing-inner">
        <div className="argus-landing-ring" aria-hidden>
          <div className="argus-landing-core">
            <Icon icon={CoreIcon} size={28} />
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
                New session
              </Button>
            </>
          ) : (
            <Button variant="primary" size="lg" icon={Plus} onClick={onCreate}>
              New session
            </Button>
          )}
        </div>
        {!minimized && promo && (
          <p className="argus-landing-promo">
            <span>New: start a saved set of sessions together.</span>
            <button type="button" className="argus-landing-promo-try" onClick={promo.onTry}>
              Try session templates (beta)
            </button>
            <button type="button" aria-label="Hide this suggestion" className="argus-landing-promo-x hover-bg-3" onClick={promo.onDismiss}>
              <Icon icon={X} size="sm" />
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
