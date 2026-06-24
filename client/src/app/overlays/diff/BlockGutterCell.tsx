import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { ChangeBlock } from './changeBlocks.js';
import { Tooltip } from '../../../components/primitives/index.js';
import { RevertConfirmCard } from './ConfirmRevert.js';
import { useSkipRevertConfirm } from '../../../hooks/useSkipRevertConfirm.js';

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
  const [pendingRevert, setPendingRevert] = useState(false);
  const [popupAnchor, setPopupAnchor] = useState<{ bottom: number; left: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const { skip: skipConfirm, toggle: toggleSkipConfirm } = useSkipRevertConfirm();
  const revertBtnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    setPendingRevert(false);
    setPopupAnchor(null);
  }, []);

  useEffect(() => {
    if (!pendingRevert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); dismiss(); }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) dismiss();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [pendingRevert, dismiss]);

  if (!block) return <div style={cellStyle} />;

  const doRevert = async () => {
    setBusy(true);
    try {
      await onRevert(block);
    } finally {
      setBusy(false);
      setPendingRevert(false);
      setPopupAnchor(null);
    }
  };

  const handleRevertClick = () => {
    if (skipConfirm) { void doRevert(); return; }
    const rect = revertBtnRef.current?.getBoundingClientRect();
    if (rect) setPopupAnchor({ bottom: window.innerHeight - rect.top + 6, left: rect.left });
    setPendingRevert(true);
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
          {isChecked && <Check size={12} strokeWidth={2.5} />}
        </button>
      </Tooltip>
      <Tooltip content="Revert change">
        <button
          ref={revertBtnRef}
          onClick={handleRevertClick}
          disabled={busy}
          style={{ ...btnStyle, color: busy ? 'var(--fg-4)' : 'var(--fg-3)' }}
        >
          <RotateCcw size={12} strokeWidth={1.8} />
        </button>
      </Tooltip>
      {pendingRevert && popupAnchor && (
        <div
          ref={popupRef}
          role="dialog"
          style={{
            position: 'fixed',
            bottom: popupAnchor.bottom,
            left: popupAnchor.left,
            zIndex: 'var(--z-tooltip)',
            background: 'var(--bg-0)',
            border: '1px solid var(--line-3)',
            borderRadius: 'var(--r-2)',
            padding: 10,
            boxShadow: 'var(--shadow-sheet)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--t-tiny)',
            color: 'var(--fg-1)',
            width: 220,
          }}
        >
          <RevertConfirmCard
            busy={busy}
            skip={skipConfirm}
            onToggleSkip={toggleSkipConfirm}
            onCancel={dismiss}
            onConfirm={() => void doRevert()}
          />
        </div>
      )}
    </div>
  );
}
