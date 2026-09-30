import { useEffect, useRef, useState } from 'react';
import { useLaunches } from '../../hooks/useLaunches.js';
import { useOverlaySuppression } from '../../hooks/useOverlaySuppression.js';
import { pushToast } from '../../components/primitives/index.js';
import { PendingLaunchCard } from './PendingLaunchCard.js';

/** Distance from the window top: clears the WindowChrome toolbar. */
const STACK_TOP = 64;
const MAX_VISIBLE = 2;

/** Hides native terminal overlays under the stack. Keyed by the parent on the
 *  visible layout, so it re-suppresses when the stack grows or shrinks. */
function SuppressUnder({ target }: { target: () => DOMRect | null }) {
  useOverlaySuppression(() => {
    const r = target();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  });
  return null;
}

export function LaunchCardStack() {
  const { pending, approve, discard } = useLaunches();
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => window.electronLaunch?.onToast((t) => pushToast(t.message, t.tone)), []);
  useEffect(() => window.electronApp?.onMenu('menu:review-launch', () => {
    ref.current?.querySelector<HTMLElement>('[data-testid="launch-prompt"], [data-testid="launch-card"] button')?.focus();
  }), []);

  if (pending.length === 0) return null;
  const visible = expanded ? pending : pending.slice(0, MAX_VISIBLE);
  const hidden = pending.length - visible.length;

  return (
    <div
      ref={ref}
      aria-live="assertive"
      aria-label="Pending launches"
      style={{ position: 'fixed', top: STACK_TOP, right: 16, zIndex: 'var(--z-pop)' as unknown as number, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <SuppressUnder key={`${visible.length}-${expanded}`} target={() => ref.current?.getBoundingClientRect() ?? null} />
      {visible.map((v, i) => (
        <PendingLaunchCard key={v.id} view={v} index={i} onApprove={approve} onDiscard={discard} />
      ))}
      {hidden > 0 && (
        <button type="button" onClick={() => setExpanded(true)} style={{ alignSelf: 'flex-end', fontSize: 'var(--t-xs)' }}>
          +{hidden} more
        </button>
      )}
    </div>
  );
}
