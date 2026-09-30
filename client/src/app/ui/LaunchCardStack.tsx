import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useLaunches } from '../../hooks/useLaunches.js';
import { useOverlaySuppression } from '../../hooks/useOverlaySuppression.js';
import { pushToast } from '../../components/primitives/index.js';
import { PendingLaunchCard } from './PendingLaunchCard.js';

/** Distance from the window top: clears the WindowChrome toolbar. */
const STACK_TOP = 64;
const MAX_VISIBLE = 2;

/** Hides native terminal overlays under the stack for as long as it is shown.
 *  Live: tiles that register or reflow under it, window resizes (the stack is
 *  right-anchored, so it moves) and its own growth all re-evaluate the rect. */
function SuppressUnder({ stack }: { stack: RefObject<HTMLDivElement | null> }) {
  useOverlaySuppression(() => {
    const r = stack.current?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, { live: true, observe: stack });
  return null;
}

const SR_ONLY: CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

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
  const newest = pending.reduce((a, b) => (b.receivedAt > a.receivedAt ? b : a));

  return (
    <div
      ref={ref}
      aria-label="Pending launches"
      style={{ position: 'fixed', top: STACK_TOP, right: 16, zIndex: 'var(--z-pop)' as unknown as number, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: `calc(100vh - ${STACK_TOP}px - 16px)`, overflowY: 'auto' }}
    >
      <SuppressUnder stack={ref} />
      {/* Announce the new request in one sentence, not the whole stack's content. */}
      <div aria-live="assertive" style={SR_ONLY}>{`Launch request: ${newest.agent} in ${newest.folder}`}</div>
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
