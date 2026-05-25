import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface MacSheetProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Panel width in px. Defaults to 480. */
  width?: number;
}

/**
 * macOS-style sheet that slides down from below the toolbar.
 * Unlike a full-screen modal, it covers only the main content area.
 * A semi-transparent overlay sits behind it over that area.
 *
 * Animation behaviour:
 * - First open (initial mount): panel appears immediately, no animation.
 * - Subsequent opens (after a close): slides in from 12 px above, 180 ms ease-out.
 *
 * This is achieved by attaching the CSS keyframe animation class only after the
 * first open cycle, tracked via a ref that persists across renders.
 */
export function MacSheet({ isOpen, onClose, title, children, footer, width = 480 }: MacSheetProps) {
  // Becomes true after the panel has been opened and then closed at least once.
  // Only then do subsequent opens get the slide-in animation.
  const hasClosedOnce = useRef(false);
  const prevOpen = useRef(isOpen);

  // Track transitions: open→close means the next open should animate
  useEffect(() => {
    if (prevOpen.current && !isOpen) {
      hasClosedOnce.current = true;
    }
    prevOpen.current = isOpen;
  });

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Apply the entrance animation only after the panel has been closed at least once.
  const animationClass = hasClosedOnce.current ? 'mac-sheet-enter' : '';

  return (
    <>
      {/*
        Keyframe definitions — injected inline so this component is self-contained.
        The keyframe name is namespaced to avoid collisions.
      */}
      <style>{`
        @keyframes mac-sheet-slide-in {
          from { opacity: 0; transform: translateY(-12px) translateX(-50%); }
          to   { opacity: 1; transform: translateY(0)    translateX(-50%); }
        }
        .mac-sheet-enter {
          animation: mac-sheet-slide-in 180ms ease-out both;
        }
      `}</style>

      {/* Scrim — covers main content only (below toolbar) */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          top: 'var(--toolbar-height, 52px)',
          background: 'var(--color-sheet-overlay, rgba(0,0,0,0.14))',
          zIndex: 149,
        }}
      />

      {/* Sheet panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={animationClass}
        style={{
          position: 'fixed',
          top: 'var(--toolbar-height, 52px)',
          left: '50%',
          // Default (non-animated) resting position
          transform: 'translateY(0) translateX(-50%)',
          width: `min(${width}px, calc(100vw - 80px))`,
          background: 'var(--color-bg-sheet, #fff)',
          borderRadius: '0 0 10px 10px',
          boxShadow: 'var(--shadow-sheet, 0 24px 80px rgba(0,0,0,0.32), 0 8px 24px rgba(0,0,0,0.18))',
          zIndex: 150,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            borderBottom: '1px solid var(--color-border-base)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </span>

          <button
            aria-label="Close"
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              borderRadius: 'var(--radius-md)',
              padding: 0,
              flexShrink: 0,
            }}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '20px 24px',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {children}
        </div>

        {/* Footer — only rendered when provided */}
        {footer && (
          <div
            style={{
              padding: '12px 24px 20px',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              borderTop: '1px solid var(--color-border-base)',
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
