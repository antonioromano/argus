import type { ReactNode } from 'react';
import { useCallback, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton.js';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';

interface SheetProps {
  title?: string;
  eyebrow?: string;
  subtitle?: string;
  width?: number;
  children?: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  isOpen?: boolean;
  /** When true, backdrop click + Escape ask before closing. Wire onConfirmClose. */
  dirty?: boolean;
  onConfirmClose?: () => void;
}

export function Sheet({
  title,
  eyebrow,
  subtitle,
  width = 480,
  children,
  footer,
  onClose,
  isOpen = true,
  dirty = false,
  onConfirmClose,
}: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const attemptClose = useCallback(() => {
    if (!onClose) return;
    if (dirty && onConfirmClose) onConfirmClose();
    else onClose();
  }, [onClose, dirty, onConfirmClose]);

  useFocusTrap({ isOpen, panelRef, onEscape: onClose ? attemptClose : undefined });

  if (!isOpen) return null;

  return (
    <div
      onClick={attemptClose}
      className="glass-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-sheet)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--s-6)',
        animation: 'argus-fade-in var(--dur-base) var(--ease-out)',
      }}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? eyebrow : undefined}
        tabIndex={-1}
        style={{
          outline: 'none',
          width,
          maxWidth: '100%',
          maxHeight: '92%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          boxShadow: 'var(--shadow-sheet)',
          borderRadius: 'var(--r-4)',
          overflow: 'hidden',
        }}
      >
        {(title || eyebrow || onClose) && (
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: 'var(--s-5) var(--s-6) var(--s-4)',
            borderBottom: '1px solid var(--line-1)',
          }}>
            <div>
              {eyebrow && (
                <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 6 }}>
                  {eyebrow}
                </div>
              )}
              {title && (
                <div id={titleId} style={{
                  fontSize: 'var(--t-xl)',
                  fontWeight: 600,
                  letterSpacing: 'var(--tracking-tight)',
                  color: 'var(--fg-0)',
                }}>
                  {title}
                </div>
              )}
              {subtitle && (
                <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-2)', marginTop: 4 }}>
                  {subtitle}
                </div>
              )}
            </div>
            {onClose && <IconButton icon={X} label="Close" onClick={attemptClose} />}
          </div>
        )}
        <div
          style={{ flex: 1, overflow: 'auto', padding: 'var(--s-5) var(--s-6)' }}
          className="argus-scroll"
        >
          {children}
        </div>
        {footer && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--s-2)',
            padding: 'var(--s-4) var(--s-6)',
            borderTop: '1px solid var(--line-1)',
            background: 'var(--bg-1)',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
