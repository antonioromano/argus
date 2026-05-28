import { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { ChangeBlock } from './changeBlocks.js';

interface BlockGutterCellProps {
  block: ChangeBlock | null; // null = row is not the start of a change-block
  isChecked: boolean;
  onToggle: (block: ChangeBlock) => void;
  onRevert: (block: ChangeBlock) => Promise<void> | void;
}

const ROW_LH = 1.6;

const cellStyle: React.CSSProperties = {
  height: `${ROW_LH}em`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  background: 'var(--bg-1)',
  borderRight: '1px solid var(--line-2)',
  position: 'relative',
};

const btnStyle: React.CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  width: 18,
  height: 18,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 3,
  color: 'var(--fg-3)',
};

export function BlockGutterCell({ block, isChecked, onToggle, onRevert }: BlockGutterCellProps) {
  const [pendingRevert, setPendingRevert] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!block) return <div style={cellStyle} />;

  const handleRevertClick = () => {
    if (pendingRevert) return;
    setPendingRevert(true);
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onRevert(block);
    } finally {
      setBusy(false);
      setPendingRevert(false);
    }
  };

  return (
    <div style={cellStyle}>
      <button
        onClick={() => onToggle(block)}
        title={isChecked ? 'Uncheck (exclude from next commit)' : 'Check (include in next commit)'}
        aria-pressed={isChecked}
        style={{
          ...btnStyle,
          border: `1px solid ${isChecked ? 'var(--accent)' : 'var(--line-3)'}`,
          background: isChecked ? 'var(--accent)' : 'transparent',
          color: isChecked ? 'var(--bg-0)' : 'var(--fg-3)',
        }}
      >
        {isChecked && <Check size={12} strokeWidth={2.5} />}
      </button>
      <button
        onClick={handleRevertClick}
        title="Revert change"
        disabled={busy}
        style={{ ...btnStyle, color: busy ? 'var(--fg-4)' : 'var(--fg-3)' }}
      >
        <RotateCcw size={12} strokeWidth={1.8} />
      </button>
      {pendingRevert && (
        <div
          role="dialog"
          style={{
            position: 'absolute',
            top: '100%',
            left: 4,
            zIndex: 20,
            marginTop: 4,
            background: 'var(--bg-0)',
            border: '1px solid var(--line-3)',
            borderRadius: 4,
            padding: 8,
            boxShadow: 'var(--shadow-sheet)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--t-tiny)',
            color: 'var(--fg-1)',
            width: 200,
          }}
        >
          <div style={{ marginBottom: 6 }}>Revert this change? Cannot be undone.</div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setPendingRevert(false)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: '2px 8px',
                borderRadius: 3,
                border: '1px solid var(--line-3)',
                color: 'var(--fg-2)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={busy}
              style={{
                all: 'unset',
                cursor: busy ? 'wait' : 'pointer',
                padding: '2px 8px',
                borderRadius: 3,
                background: 'var(--danger)',
                color: 'var(--bg-0)',
              }}
            >
              {busy ? 'Reverting…' : 'Revert'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
