import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton.js';

const WIDTHS: Record<string, string> = {
  sm: '360px',
  md: '520px',
  lg: '600px',
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  /** Optional footer content (action buttons). */
  footer?: ReactNode;
  /** Max height as CSS value. Defaults to '80vh'. */
  maxHeight?: string;
}

export function Modal({ isOpen, onClose, title, size = 'md', children, footer, maxHeight = '80vh' }: ModalProps) {
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

  return (
    <div
      onClick={onClose}
      className="glass-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(12,13,24,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--z-modal)' as unknown as number,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="glass-panel"
        style={{
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-6)',
          width: WIDTHS[size],
          maxWidth: '90vw',
          maxHeight,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {title}
          </h2>
          <IconButton icon={X} label="Close" onClick={onClose} size="sm" />
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-5)', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
