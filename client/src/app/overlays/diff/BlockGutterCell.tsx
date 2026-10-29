import { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { ChangeBlock } from './changeBlocks.js';
import { Tooltip, Icon } from '../../../components/primitives/index.js';

interface BlockGutterCellProps {
  block: ChangeBlock | null;
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
  borderRadius: 'var(--r-2)',
  color: 'var(--fg-3)',
};

export function BlockGutterCell({ block, isChecked, onToggle, onRevert }: BlockGutterCellProps) {
  const [busy, setBusy] = useState(false);

  if (!block) return <div style={cellStyle} />;

  const doRevert = async () => {
    setBusy(true);
    try {
      await onRevert(block);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={cellStyle}>
      <Tooltip content={isChecked ? 'Uncheck (exclude from next commit)' : 'Check (include in next commit)'}>
        <button
          onClick={() => onToggle(block)}
          aria-pressed={isChecked}
          style={{
            ...btnStyle,
            border: `1px solid ${isChecked ? 'var(--accent)' : 'var(--line-3)'}`,
            background: isChecked ? 'var(--accent)' : 'transparent',
            color: isChecked ? 'var(--bg-0)' : 'var(--fg-3)',
          }}
        >
          {isChecked && <Icon icon={Check} size={12} strokeWidth={2.5} />}
        </button>
      </Tooltip>
      <Tooltip content="Revert change">
        <button
          onClick={() => void doRevert()}
          disabled={busy}
          style={{ ...btnStyle, color: busy ? 'var(--fg-4)' : 'var(--fg-3)' }}
        >
          <Icon icon={RotateCcw} size={12} strokeWidth={1.8} />
        </button>
      </Tooltip>
    </div>
  );
}
