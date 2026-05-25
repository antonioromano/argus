import { useEffect } from 'react';

interface ConfirmActionDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  isDestructive = false,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  // Trap Enter → confirm, Escape → cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onConfirm, onCancel]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--color-surface, #1e1e1e)',
          border: '1px solid var(--color-border-base, rgba(255,255,255,0.12))',
          borderRadius: '8px',
          padding: '20px 24px',
          minWidth: '320px',
          maxWidth: '480px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <h3
          style={{
            margin: '0 0 8px',
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--color-text)',
          }}
        >
          {title}
        </h3>
        <p
          style={{
            margin: '0 0 20px',
            fontSize: '13px',
            color: 'var(--color-text-secondary, rgba(255,255,255,0.6))',
          }}
        >
          {description}
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 14px',
              borderRadius: '4px',
              border: '1px solid var(--color-border-base)',
              background: 'none',
              color: 'var(--color-text)',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Cancel
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            style={{
              padding: '6px 14px',
              borderRadius: '4px',
              border: 'none',
              background: isDestructive
                ? 'var(--color-error, #ef4444)'
                : 'var(--color-accent, #4a90e2)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
