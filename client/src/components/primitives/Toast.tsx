import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Check, AlertTriangle, AlertOctagon, X } from 'lucide-react';
import { useOverlaySuppression } from '../../hooks/useOverlaySuppression.js';
import { Icon } from './Icon.js';

export type ToastTone = 'ok' | 'warn' | 'danger';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let externalPush: ToastContextValue['push'] | null = null;
let nextId = 1;

// eslint-disable-next-line react-refresh/only-export-components
export function pushToast(message: string, tone: ToastTone = 'ok'): void {
  externalPush?.(message, tone);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return { push: () => { /* no provider — silently drop */ } };
  }
  return ctx;
}

// How long a toast stays up before fading. Errors carry information the user
// has to read (and may need to act on), so they stay much longer, pause while
// hovered/focused, and can be dismissed — a 1.5s error is unreadable and fails
// WCAG 2.2.1 (Timing Adjustable). Confirmations stay brief.
const DURATION: Record<ToastTone, number> = { ok: 1500, warn: 1500, danger: 6000 };
const FADE_OUT = 200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = 'ok') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, tone }]);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    externalPush = push;
    return () => {
      externalPush = null;
    };
  }, [push]);

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
            <ToastView key={t.id} item={t} onDone={remove} />
          ))}
        </div>
        <div role="status" aria-live="polite" aria-atomic="false" style={STACK}>
          {toasts.filter((t) => t.tone !== 'danger').map((t) => (
            <ToastView key={t.id} item={t} onDone={remove} />
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

function ToastView({ item, onDone }: { item: ToastItem; onDone: (id: number) => void }) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dismissible = item.tone === 'danger';

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
    const t = setTimeout(() => setLeaving(true), DURATION[item.tone]);
    return () => clearTimeout(t);
  }, [paused, leaving, item.tone]);

  // Fade out, then drop from the list.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => onDone(item.id), FADE_OUT);
    return () => clearTimeout(t);
  }, [leaving, item.id, onDone]);

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
      {dismissible && (
        // Always rendered (never hover-revealed) so the toast never changes size.
        <button
          type="button"
          aria-label="Dismiss"
          className="hover-bg-3"
          onClick={() => setLeaving(true)}
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
