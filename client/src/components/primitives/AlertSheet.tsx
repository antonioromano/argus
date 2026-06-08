import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';

interface AlertSheetProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmDestructive?: boolean;
  /** Disables actions and shows the confirm button as busy (for async confirms). */
  confirmLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  altAction?: { label: string; onClick: () => void };
  /** Optional "don't ask again" checkbox shown above the action row. */
  rememberChoice?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
}

export function AlertSheet({
  isOpen,
  title,
  message,
  confirmLabel,
  confirmDestructive = false,
  confirmLoading = false,
  onConfirm,
  onCancel,
  altAction,
  rememberChoice,
}: AlertSheetProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const id = requestAnimationFrame(() => confirmRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const confirmBg = confirmDestructive ? 'var(--danger)' : 'var(--accent)';
  const confirmFg = confirmDestructive ? '#ffffff' : 'var(--fg-on-accent)';

  const ghostBtn: React.CSSProperties = {
    flex: 1,
    height: 32,
    border: '1px solid var(--line-3)',
    background: 'transparent',
    color: 'var(--fg-1)',
    borderRadius: 'var(--r-2)',
    fontSize: 'var(--t-sm)',
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
  };

  return (
    <div
      onClick={onCancel}
      className="glass-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--z-overlay)',
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 320,
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-4)',
          boxShadow: 'var(--shadow-sheet)',
          padding: 'var(--s-5) var(--s-5) var(--s-4)',
          animation: 'argus-fade-in var(--dur-base) var(--ease-out) both',
        }}
      >
        <p
          style={{
            margin: '0 0 6px',
            fontSize: 'var(--t-md)',
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            color: 'var(--fg-0)',
            lineHeight: 1.3,
          }}
        >
          {title}
        </p>
        <p
          style={{
            margin: '0 0 var(--s-5)',
            fontSize: 'var(--t-sm)',
            fontFamily: 'var(--font-sans)',
            color: 'var(--fg-1)',
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>
        {rememberChoice && (
          <button
            type="button"
            onClick={() => rememberChoice.onChange(!rememberChoice.checked)}
            disabled={confirmLoading}
            aria-checked={rememberChoice.checked}
            role="checkbox"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-2)',
              margin: '0 0 var(--s-4)',
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: 'var(--fg-1)',
              fontSize: 'var(--t-sm)',
              fontFamily: 'var(--font-sans)',
              cursor: confirmLoading ? 'default' : 'pointer',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--r-1)',
                border: `1px solid ${rememberChoice.checked ? 'var(--accent)' : 'var(--line-3)'}`,
                background: rememberChoice.checked ? 'var(--accent)' : 'var(--bg-2)',
                color: rememberChoice.checked ? 'var(--bg-0)' : 'transparent',
              }}
            >
              {rememberChoice.checked && <Check size={11} strokeWidth={2.5} />}
            </span>
            {rememberChoice.label}
          </button>
        )}
        <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
          <button onClick={onCancel} disabled={confirmLoading} style={{ ...ghostBtn, opacity: confirmLoading ? 0.5 : 1 }}>Cancel</button>
          {altAction && (
            <button onClick={() => { altAction.onClick(); onCancel(); }} disabled={confirmLoading} style={ghostBtn}>
              {altAction.label}
            </button>
          )}
          {confirmDestructive && <div style={{ width: 'var(--s-3)' }} aria-hidden="true" />}
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={confirmLoading}
            aria-busy={confirmLoading}
            style={{
              flex: 1,
              height: 32,
              border: 'none',
              background: confirmBg,
              color: confirmFg,
              borderRadius: 'var(--r-2)',
              fontSize: 'var(--t-sm)',
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              cursor: confirmLoading ? 'default' : 'pointer',
              opacity: confirmLoading ? 0.7 : 1,
            }}
          >
            {confirmLoading ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
