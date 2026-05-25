import { useEffect, useRef } from 'react';

interface AlertSheetProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** When true, the confirm button renders with a destructive (error) colour. */
  confirmDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional third action rendered between Cancel and Confirm (macOS HIG: 3-button alert). */
  altAction?: { label: string; onClick: () => void };
}

/**
 * Compact macOS-style alert sheet for confirming destructive or important
 * actions (e.g., delete session, restart). Renders centred over the full
 * viewport with a light overlay behind it.
 */
export function AlertSheet({
  isOpen,
  title,
  message,
  confirmLabel,
  confirmDestructive = false,
  onConfirm,
  onCancel,
  altAction,
}: AlertSheetProps) {
  // Auto-focus the confirm button so Enter / Space works immediately.
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Defer by one frame to ensure the element is visible before focusing.
      const id = requestAnimationFrame(() => confirmRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isOpen]);

  const panelRef = useRef<HTMLDivElement>(null);

  // Dismiss on Escape + trap Tab/Shift+Tab focus inside the panel.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>('button:not([disabled])'),
      );
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

  const confirmBg = confirmDestructive
    ? 'var(--color-error)'
    : 'var(--color-accent)';

  return (
    /* Full-viewport scrim */
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-overlay-weak)',
        zIndex: 200,
        // Scale animation applied via CSS animation on the inner panel
      }}
    >
      {/* Alert panel */}
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 300,
          background: 'var(--color-bg-sheet, var(--color-bg-modal))',
          borderRadius: 12,
          boxShadow: 'var(--shadow-sheet)',
          padding: '20px 20px 16px',
          // Scale-in entrance
          animation: 'mac-alert-in 150ms ease-out both',
        }}
      >
        <p
          style={{
            margin: '0 0 6px',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            color: 'var(--color-text-primary)',
            lineHeight: 1.3,
          }}
        >
          {title}
        </p>

        <p
          style={{
            margin: '0 0 18px',
            fontSize: 13,
            fontFamily: 'var(--font-sans)',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          {/* Cancel */}
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              height: 32,
              border: '1px solid var(--color-border-subtle)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              borderRadius: 8,
              fontSize: 13,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>

          {/* Optional third action (middle button — macOS HIG 3-button alert) */}
          {altAction && (
            <button
              onClick={() => { altAction.onClick(); onCancel(); }}
              style={{
                flex: 1,
                height: 32,
                border: '1px solid var(--color-border-subtle)',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                borderRadius: 8,
                fontSize: 13,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
              }}
            >
              {altAction.label}
            </button>
          )}

          {/* Confirm */}
          <button
            ref={confirmRef}
            onClick={onConfirm}
            style={{
              flex: 1,
              height: 32,
              border: 'none',
              background: confirmBg,
              color: '#fff',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>

      {/*
        Keyframe for the scale-in animation.
        Injected as a <style> tag so we don't need a CSS file.
        The keyframe is idempotent — safe to add multiple times.
      */}
      <style>{`
        @keyframes mac-alert-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
