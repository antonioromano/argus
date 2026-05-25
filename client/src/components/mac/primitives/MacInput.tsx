import { useId } from 'react';
import type { ReactNode } from 'react';

interface MacInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'email' | 'search';
  error?: string;
  disabled?: boolean;
  mono?: boolean;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  id?: string;
  className?: string;
  /** Right-side adornment (icon or button) */
  suffix?: ReactNode;
}

export function MacInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  error,
  disabled = false,
  mono = false,
  autoFocus,
  onKeyDown,
  id: idProp,
  className,
  suffix,
}: MacInputProps) {
  const autoId = useId();
  const id = idProp ?? autoId;

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
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          className={className}
          style={{
            flex: 1,
            height: 'var(--control-height-md, 26px)',
            padding: suffix ? '0 28px 0 8px' : '0 8px',
            fontSize: 'var(--text-sm)',
            fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
            color: 'var(--color-text-primary)',
            background: 'var(--color-control-bg, var(--color-bg-input))',
            border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-control-border, var(--color-border-base))'}`,
            borderRadius: 6,
            outline: 'none',
            cursor: disabled ? 'not-allowed' : 'text',
            opacity: disabled ? 0.5 : 1,
            boxSizing: 'border-box',
            width: '100%',
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
        {suffix && (
          <div
            style={{
              position: 'absolute',
              right: 6,
              display: 'flex',
              alignItems: 'center',
              color: 'var(--color-text-muted)',
              pointerEvents: 'none',
            }}
          >
            {suffix}
          </div>
        )}
      </div>
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
