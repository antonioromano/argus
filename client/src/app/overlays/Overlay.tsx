import type { ReactNode } from 'react';
import { useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';

interface OverlayProps {
  onClose: () => void;
  children: ReactNode;
  align?: 'center' | 'top';
  /** Accessible name for the dialog (screen readers announce it on open). */
  label?: string;
  /**
   * Set false when the child renders its own dialog (e.g. a <Sheet>), so we
   * don't nest role="dialog" / double focus traps. Defaults true.
   */
  dialog?: boolean;
}

export function Overlay({ onClose, children, align = 'center', label = 'Dialog', dialog = true }: OverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap({ isOpen: dialog, panelRef, onEscape: dialog ? onClose : undefined });

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="glass-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-sheet)',
        display: 'flex',
        alignItems: align === 'top' ? 'flex-start' : 'center',
        justifyContent: 'center',
        paddingTop: align === 'top' ? '10vh' : 'var(--s-6)',
        paddingBottom: 'var(--s-6)',
        animation: 'argus-fade-in var(--dur-base) var(--ease-out)',
      }}
    >
      <div
        ref={panelRef}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        role={dialog ? 'dialog' : undefined}
        aria-modal={dialog ? true : undefined}
        aria-label={dialog ? label : undefined}
        tabIndex={dialog ? -1 : undefined}
        style={{ display: 'inline-flex', maxHeight: '90vh', maxWidth: '90vw', outline: 'none' }}
      >
        {children}
      </div>
    </div>
  );
}
