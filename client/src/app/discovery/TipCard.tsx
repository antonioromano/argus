import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Lightbulb, X } from 'lucide-react';
import type { ToastAction, ToastCloseReason } from '../../components/primitives/Toast.js';
import { Button, Icon } from '../../components/primitives/index.js';
import { useOverlaySuppression } from '../../hooks/useOverlaySuppression.js';

export interface TipCardProps {
  title: string;
  body: ReactNode;
  /** Live key combo for the feature, e.g. "⌘⇧J". */
  combo?: string;
  /** The one action, as on an action toast. Runs after the card closes. */
  primary?: ToastAction;
  /** Label of the quiet close button (default "Got it"). */
  dismissLabel?: string;
  /** Same close reasons as a toast: `action` (primary clicked), `dismiss`. */
  onClose: (reason: ToastCloseReason) => void;
  /** Shown as a quiet "Turn off tips" link when present. */
  onDisableAll?: () => void;
  /** A follow-up line under the actions (the notification ask's System Settings link). */
  footnote?: ReactNode;
}

/**
 * A one-time hint. Not a toast, on purpose: a toast reports something that
 * happened and fades (docs/design/feedback-surfaces.md); a tip is reading the
 * user opted into, carries a decision, and must not vanish mid-sentence. It
 * borrows the toast's contract (one action, close reasons, overlay
 * suppression, enter motion) and sits bottom-left so the two never stack.
 *
 * It never takes focus: someone typing into a session must not lose keys to it.
 * Esc closes it only while focus is inside the card.
 */
export function TipCard({ title, body, combo, primary, dismissLabel = 'Got it', onClose, onDisableAll, footnote }: TipCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  // Mounted only while visible, so a native terminal under it is hidden exactly that long.
  useOverlaySuppression(() => ref.current?.getBoundingClientRect() ?? null);

  useEffect(() => {
    const f = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(f);
  }, []);

  const runPrimary = () => {
    if (!primary) return;
    onClose('action');
    try {
      void Promise.resolve(primary.run()).catch((err: unknown) => console.error('[tip] action failed', err));
    } catch (err) {
      console.error('[tip] action failed', err);
    }
  };

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-label={title}
      className="argus-tipcard material-float"
      data-shown={shown ? '' : undefined}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose('dismiss'); } }}
    >
      <div className="argus-tipcard-head">
        <Icon icon={Lightbulb} size={13} strokeWidth={1.8} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className="argus-tipcard-title">{title}</span>
        <button type="button" aria-label="Dismiss" className="argus-tipcard-x hover-bg-3" onClick={() => onClose('dismiss')}>
          <Icon icon={X} size={12} strokeWidth={1.8} />
        </button>
      </div>
      <div className="argus-tipcard-body">
        {body}
        {combo && <> <kbd className="argus-tipcard-kbd">{combo}</kbd></>}
      </div>
      <div className="argus-tipcard-actions">
        {primary && <Button size="sm" variant="primary" onClick={runPrimary}>{primary.label}</Button>}
        <Button size="sm" variant="ghost" onClick={() => onClose('dismiss')}>{dismissLabel}</Button>
        {onDisableAll && (
          <button type="button" className="argus-tipcard-off" onClick={() => { onClose('dismiss'); onDisableAll(); }}>
            Turn off tips
          </button>
        )}
      </div>
      {footnote && <div className="argus-tipcard-foot">{footnote}</div>}
    </div>
  );
}
