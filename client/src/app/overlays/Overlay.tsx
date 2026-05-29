import type { ReactNode } from 'react';
import { useEffect } from 'react';

interface OverlayProps {
  onClose: () => void;
  children: ReactNode;
  align?: 'center' | 'top';
}

export function Overlay({ onClose, children, align = 'center' }: OverlayProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="glass-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: align === 'top' ? 'flex-start' : 'center',
        justifyContent: 'center',
        paddingTop: align === 'top' ? '10vh' : 'var(--s-6)',
        paddingBottom: align === 'top' ? 'var(--s-6)' : 'var(--s-6)',
        animation: 'argus-fade-in var(--dur-base) var(--ease-out)',
      }}
    >
      <div
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{ display: 'inline-flex', maxHeight: '90vh', maxWidth: '90vw' }}
      >
        {children}
      </div>
    </div>
  );
}
