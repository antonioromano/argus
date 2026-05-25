import { useId } from 'react';

interface MacSelectOption {
  value: string;
  label: string;
}

interface MacSelectProps {
  label?: string;
  options: MacSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}

export function MacSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  error,
}: MacSelectProps) {
  const id = useId();

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
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          height: 'var(--control-height-md, 26px)',
          padding: '0 24px 0 8px',
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-sans)',
          color: 'var(--color-text-primary)',
          background: 'var(--color-control-bg, var(--color-bg-input))',
          border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-control-border, var(--color-border-base))'}`,
          borderRadius: 6,
          outline: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          boxSizing: 'border-box',
          width: '100%',
          appearance: 'auto',
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
      >
        {placeholder && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <span
          role="alert"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', fontFamily: 'var(--font-sans)' }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
