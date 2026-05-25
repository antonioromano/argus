import { useEffect, useRef } from 'react';

interface HunkActionPopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}

export function HunkActionPopover({ anchorRef, onConfirm, onCancel }: HunkActionPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Position the popover below the anchor element on mount
  useEffect(() => {
    if (!anchorRef.current || !popoverRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    popoverRef.current.style.top = `${rect.bottom + 4}px`;
    popoverRef.current.style.left = `${rect.left}px`;
  }, [anchorRef]);

  // Dismiss on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        !popoverRef.current?.contains(e.target as Node) &&
        !anchorRef.current?.contains(e.target as Node)
      ) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, onCancel]);

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        zIndex: 1000,
        background: 'var(--color-bg-elevated, var(--color-surface, #1e1e1e))',
        border: '1px solid var(--color-border-base, rgba(255,255,255,0.12))',
        borderRadius: '6px',
        padding: '10px 12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        minWidth: '200px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <div>
        <div
          style={{
            fontWeight: 500,
            fontSize: '13px',
            color: 'var(--color-text-primary, inherit)',
          }}
        >
          Discard this hunk?
        </div>
        <div
          style={{
            fontSize: '12px',
            color: 'var(--color-text-secondary, rgba(255,255,255,0.5))',
            marginTop: '2px',
          }}
        >
          This cannot be undone.
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            background: 'none',
            border: '1px solid var(--color-border-base, rgba(255,255,255,0.2))',
            borderRadius: '4px',
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: '12px',
            color: 'var(--color-text-primary, inherit)',
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          style={{
            background: 'var(--color-error, #e74c3c)',
            border: 'none',
            borderRadius: '4px',
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: '12px',
            color: '#fff',
            fontWeight: 500,
          }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
