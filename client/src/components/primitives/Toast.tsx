import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Check, AlertTriangle, AlertOctagon } from 'lucide-react';

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

const DURATION = 1500;
const FADE_OUT = 200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = 'ok') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DURATION + FADE_OUT);
  }, []);

  useEffect(() => {
    externalPush = push;
    return () => {
      externalPush = null;
    };
  }, [push]);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
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
        {toasts.map((t) => (
          <ToastView key={t.id} item={t} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item }: { item: ToastItem }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const inFrame = requestAnimationFrame(() => setVisible(true));
    const outTimer = setTimeout(() => setVisible(false), DURATION);
    return () => {
      cancelAnimationFrame(inFrame);
      clearTimeout(outTimer);
    };
  }, []);

  const palette = TONE[item.tone];
  const Icon = palette.icon;

  return (
    <div
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
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(4px)',
        transition: 'opacity 200ms var(--ease-std), transform 200ms var(--ease-std)',
        pointerEvents: 'auto',
      }}
    >
      <Icon size={12} strokeWidth={1.8} />
      <span>{item.message}</span>
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
