import { useId, useEffect, useRef } from 'react';

interface MacTextareaProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  mono?: boolean;
  autoFocus?: boolean;
  rows?: number;
  maxRows?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function MacTextarea({
  label,
  value,
  onChange,
  placeholder,
  error,
  disabled = false,
  mono = false,
  autoFocus,
  rows = 2,
  maxRows = 6,
  onKeyDown,
}: MacTextareaProps) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const lineHeight = 20;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const min = rows * lineHeight + 16;
    const max = maxRows * lineHeight + 16;
    el.style.height = Math.min(Math.max(el.scrollHeight, min), max) + 'px';
  }, [value, rows, maxRows]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label
          htmlFor={id}
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-sans)',
            userSelect: 'none',
          }}
        >
          {label}
        </label>
      )}
      <textarea
        id={id}
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        style={{
          padding: '6px 8px',
          fontSize: 'var(--text-sm)',
          lineHeight: `${lineHeight}px`,
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          color: 'var(--color-text-primary)',
          background: 'var(--color-control-bg, var(--color-bg-input))',
          border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-control-border, var(--color-border-base))'}`,
          borderRadius: 6,
          outline: 'none',
          resize: 'none',
          cursor: disabled ? 'not-allowed' : 'text',
          opacity: disabled ? 0.5 : 1,
          boxSizing: 'border-box',
          width: '100%',
          minHeight: rows * lineHeight + 16,
          maxHeight: maxRows * lineHeight + 16,
          overflowY: 'auto',
          transition: 'border-color 0.12s ease, box-shadow 0.12s ease',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--color-control-border-focus, var(--color-accent))';
          e.currentTarget.style.boxShadow = '0 0 0 3px var(--color-control-focus-ring, rgba(0,122,255,0.3))';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = error
            ? 'var(--color-error)'
            : 'var(--color-control-border, var(--color-border-base))';
          e.currentTarget.style.boxShadow = 'none';
        }}
      />
      {error && (
        <span
          role="alert"
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-error)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
