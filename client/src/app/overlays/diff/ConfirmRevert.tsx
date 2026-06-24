import { Check } from 'lucide-react';

export interface RevertConfirmCardProps {
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
  busy?: boolean;
  skip: boolean;
  onToggleSkip: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Layout-agnostic confirm body (message + "Don't ask again" + Cancel/Confirm).
 * Callers wrap it in their own container (fixed popover, inline strip, …).
 * Used by BlockGutterCell, FileSection rollback, and the sidebar file revert.
 */
export function RevertConfirmCard({
  title = 'Revert this change?',
  subtitle = 'Cannot be undone.',
  confirmLabel = 'Revert',
  busy = false,
  skip,
  onToggleSkip,
  onCancel,
  onConfirm,
}: RevertConfirmCardProps) {
  return (
    <div style={{ fontFamily: 'var(--font-sans)' }}>
      <div style={{ marginBottom: 8, fontSize: 'var(--t-xs)', color: 'var(--fg-0)', fontWeight: 500, lineHeight: 1.4 }}>
        {title}
        <br />
        <span style={{ color: 'var(--fg-3)', fontWeight: 400 }}>{subtitle}</span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, cursor: 'pointer', userSelect: 'none' }}>
        <span
          role="checkbox"
          aria-checked={skip}
          onClick={(e) => { e.preventDefault(); onToggleSkip(); }}
          style={{
            width: 13, height: 13, flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 2,
            border: `1px solid ${skip ? 'var(--accent)' : 'var(--line-3)'}`,
            background: skip ? 'var(--accent)' : 'var(--bg-2)',
            color: skip ? 'var(--bg-0)' : 'transparent',
          }}
        >
          {skip && <Check size={9} strokeWidth={2.5} />}
        </span>
        <span style={{ fontSize: 'var(--t-tiny)', color: 'var(--fg-2)' }}>Don't ask again</span>
      </label>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            all: 'unset', cursor: 'pointer',
            padding: '3px 10px', borderRadius: 'var(--r-2)',
            border: '1px solid var(--line-3)', color: 'var(--fg-2)',
            fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)',
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          style={{
            all: 'unset', cursor: busy ? 'wait' : 'pointer',
            padding: '3px 10px', borderRadius: 'var(--r-2)',
            background: 'var(--danger)', color: 'var(--bg-0)',
            fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)',
          }}
        >
          {busy ? `${confirmLabel}…` : confirmLabel}
        </button>
      </div>
    </div>
  );
}
