import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Check, AlertTriangle, AlertOctagon, X } from 'lucide-react';
import { useOverlaySuppression } from '../../hooks/useOverlaySuppression.js';
import { Icon } from './Icon.js';

export type ToastTone = 'ok' | 'warn' | 'danger';

/** Why a toast closed. `action` = its button was clicked; `evicted` = pushed out by the action-toast cap. */
export type ToastCloseReason = 'timeout' | 'dismiss' | 'action' | 'evicted';

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastOptions {
  /** One action button (Undo, Reopen, Review…). Makes the toast dismissible and hover/focus-pausable. */
  action?: ToastAction;
  /** Overrides the tone's default lifetime. */
  durationMs?: number;
  /** Fires exactly once, when the toast starts to close. */
  onClose?: (reason: ToastCloseReason) => void;
}

export interface ToastHandle {
  /** Close the toast now (reported as `dismiss`). No-op once it has closed. */
  dismiss(): void;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  durationMs: number;
  leaving: boolean;
}

type PushFn = (message: string, tone?: ToastTone, opts?: ToastOptions) => ToastHandle;

interface ToastContextValue {
  push: PushFn;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let externalPush: PushFn | null = null;
let nextId = 1;

/**
 * With no provider mounted the toast can never be seen, so it closes at once as
 * `dismiss`. That keeps a deferred commit (utils/undoable) from being stranded.
 */
function pushWithoutProvider(_message: string, _tone?: ToastTone, opts?: ToastOptions): ToastHandle {
  opts?.onClose?.('dismiss');
  return { dismiss: () => { /* already closed */ } };
}

// eslint-disable-next-line react-refresh/only-export-components
export function pushToast(message: string, tone: ToastTone = 'ok', opts?: ToastOptions): ToastHandle {
  return (externalPush ?? pushWithoutProvider)(message, tone, opts);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  return ctx ?? NO_PROVIDER;
}

const NO_PROVIDER: ToastContextValue = { push: pushWithoutProvider };

// How long a toast stays up before fading. Errors carry information the user
// has to read (and may need to act on), so they stay much longer, pause while
// hovered/focused, and can be dismissed — a 1.5s error is unreadable and fails
// WCAG 2.2.1 (Timing Adjustable). Confirmations stay brief. Action toasts
// (Undo, Reopen) default to 6s; callers pass 10s for heavier undos.
const DURATION: Record<ToastTone, number> = { ok: 1500, warn: 1500, danger: 6000 };
const ACTION_DURATION = 6000;
/** Most action toasts on screen at once; a newer one evicts the oldest. */
const MAX_ACTION_TOASTS = 3;
const FADE_OUT = 200;

/** Close bookkeeping lives outside React state so onClose fires exactly once, never from an updater. */
interface ToastEntry {
  hasAction: boolean;
  closed: boolean;
  onClose?: (reason: ToastCloseReason) => void;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const entries = useRef(new Map<number, ToastEntry>());

  const close = useCallback((id: number, reason: ToastCloseReason) => {
    const entry = entries.current.get(id);
    if (!entry || entry.closed) return;
    entry.closed = true;
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    entry.onClose?.(reason);
  }, []);

  const push = useCallback<PushFn>((message, tone = 'ok', opts) => {
    const id = nextId++;
    const action = opts?.action;
    if (action) {
      const open = [...entries.current].filter(([, e]) => e.hasAction && !e.closed);
      for (const [oldId] of open.slice(0, Math.max(0, open.length - MAX_ACTION_TOASTS + 1))) {
        close(oldId, 'evicted');
      }
    }
    entries.current.set(id, { hasAction: !!action, closed: false, onClose: opts?.onClose });
    const durationMs = opts?.durationMs ?? (action ? ACTION_DURATION : DURATION[tone]);
    setToasts((prev) => [...prev, { id, message, tone, action, durationMs, leaving: false }]);
    return { dismiss: () => close(id, 'dismiss') };
  }, [close]);

  const remove = useCallback((id: number) => {
    entries.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    externalPush = push;
    const open = entries.current;
    return () => {
      if (externalPush === push) externalPush = null;
      // Unmount closes every open toast as a dismiss, so pending commits flush.
      for (const id of [...open.keys()]) close(id, 'dismiss');
    };
  }, [push, close]);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
          zIndex: 'var(--z-toast)',
          pointerEvents: 'none',
        }}
      >
        {/* Errors are announced assertively; confirmations/warnings politely.
            Both regions stay mounted so screen readers track them. */}
        <div role="alert" style={STACK}>
          {toasts.filter((t) => t.tone === 'danger').map((t) => (
            <ToastView key={t.id} item={t} onClose={close} onGone={remove} />
          ))}
        </div>
        <div role="status" aria-live="polite" aria-atomic="false" style={STACK}>
          {toasts.filter((t) => t.tone !== 'danger').map((t) => (
            <ToastView key={t.id} item={t} onClose={close} onGone={remove} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

const STACK: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 8,
};

function ToastView({
  item,
  onClose,
  onGone,
}: {
  item: ToastItem;
  onClose: (id: number, reason: ToastCloseReason) => void;
  onGone: (id: number) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { leaving, action } = item;
  const dismissible = item.tone === 'danger' || !!action;

  // Each toast is its own component instance, mounted when it's added to the
  // list and unmounted when it's removed — a real mount/unmount matching its
  // on-screen lifetime, unlike ToastProvider which is permanent.
  useOverlaySuppression(() => ref.current?.getBoundingClientRect() ?? null);

  useEffect(() => {
    const inFrame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(inFrame);
  }, []);

  // Auto-dismiss timer. Hover/focus pauses it; leaving restarts the full
  // duration so the user always gets a complete read after looking away.
  useEffect(() => {
    if (paused || leaving) return;
    const t = setTimeout(() => onClose(item.id, 'timeout'), item.durationMs);
    return () => clearTimeout(t);
  }, [paused, leaving, item.id, item.durationMs, onClose]);

  // Fade out, then drop from the list.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => onGone(item.id), FADE_OUT);
    return () => clearTimeout(t);
  }, [leaving, item.id, onGone]);

  const runAction = () => {
    if (!action || leaving) return;
    // Close first so a slow or failing run can never be followed by a timeout close.
    onClose(item.id, 'action');
    try {
      void Promise.resolve(action.run()).catch((err: unknown) => console.error('[toast] action failed', err));
    } catch (err) {
      console.error('[toast] action failed', err);
    }
  };

  const shown = visible && !leaving;

  const palette = TONE[item.tone];
  const Glyph = palette.icon;

  return (
    <div
      ref={ref}
      className="eyebrow"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        minHeight: 32,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.border}`,
        borderRadius: 'var(--r-2)',
        fontSize: 'var(--t-tiny)',
        boxShadow: 'var(--shadow-sheet)',
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(4px)',
        transition: 'opacity 200ms var(--ease-std), transform 200ms var(--ease-std)',
        pointerEvents: 'auto',
      }}
      onMouseEnter={dismissible ? () => setPaused(true) : undefined}
      onMouseLeave={dismissible ? () => setPaused(false) : undefined}
      onFocus={dismissible ? () => setPaused(true) : undefined}
      onBlur={dismissible ? () => setPaused(false) : undefined}
    >
      <Icon icon={Glyph} size={12} strokeWidth={1.8} />
      <span>{item.message}</span>
      {action && (
        // Always rendered (never hover-revealed) so the toast never changes size.
        <button
          type="button"
          className="hover-bg-3"
          onClick={runAction}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 'var(--ctl-h-xs)',
            padding: '0 var(--s-2)',
            border: 'none',
            borderRadius: 'var(--r-1)',
            background: 'transparent',
            color: 'var(--accent)',
            font: 'inherit',
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {action.label}
        </button>
      )}
      {dismissible && (
        // Always rendered (never hover-revealed) so the toast never changes size.
        <button
          type="button"
          aria-label="Dismiss"
          className="hover-bg-3"
          onClick={() => onClose(item.id, 'dismiss')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            marginRight: -6,
            padding: 0,
            border: 'none',
            borderRadius: 'var(--r-1)',
            background: 'transparent',
            color: 'var(--fg-2)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Icon icon={X} size={12} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

const TONE: Record<ToastTone, { bg: string; fg: string; border: string; icon: typeof Check }> = {
  ok: {
    bg: 'var(--bg-2)',
    fg: 'var(--ok)',
    border: 'color-mix(in srgb, var(--ok) 33%, transparent)',
    icon: Check,
  },
  warn: {
    bg: 'var(--bg-2)',
    fg: 'var(--warn)',
    border: 'color-mix(in srgb, var(--warn) 33%, transparent)',
    icon: AlertTriangle,
  },
  danger: {
    bg: 'var(--bg-2)',
    fg: 'var(--danger)',
    border: 'color-mix(in srgb, var(--danger) 33%, transparent)',
    icon: AlertOctagon,
  },
};
