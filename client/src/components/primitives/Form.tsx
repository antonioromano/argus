import type { ReactNode, CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

/* ===== Field — labeled wrapper ===== */
interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldProps) {
  return (
    <label style={{ display: 'block' }}>
      {label && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}>
          <span className="eyebrow" style={{ color: error ? 'var(--danger)' : 'var(--fg-2)' }}>
            {label}
            {required && (
              <>
                <span aria-hidden="true" style={{ color: 'var(--accent)', marginLeft: 4 }}>*</span>
                <span style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>required</span>
              </>
            )}
          </span>
          {hint && <span style={{ fontSize: 'var(--t-tiny)', color: 'var(--fg-3)' }}>{hint}</span>}
        </div>
      )}
      {children}
      {error && <div style={{ marginTop: 4, fontSize: 'var(--t-tiny)', color: 'var(--danger)' }}>{error}</div>}
    </label>
  );
}

/* ===== SettingRow — horizontal setting row (label/hint left, control right) ===== */
interface SettingRowProps {
  label?: string;
  hint?: string;
  /** Align the control to the right with no meta column (e.g. a trailing action button). */
  trailing?: boolean;
  children: ReactNode;
}

export function SettingRow({ label, hint, trailing, children }: SettingRowProps) {
  return (
    <div className="setting-row" style={trailing ? { justifyContent: 'flex-end' } : undefined}>
      {!trailing && (label || hint) && (
        <div className="setting-row-meta">
          {label && <div className="setting-row-label">{label}</div>}
          {hint && <div className="setting-row-hint">{hint}</div>}
        </div>
      )}
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

/* ===== TextInput ===== */
interface TextInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  icon?: LucideIcon;
  suffix?: string | ReactNode;
  autoFocus?: boolean;
  style?: CSSProperties;
  error?: boolean;
  type?: 'text' | 'password' | 'email' | 'search';
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  autoComplete?: string;
  spellCheck?: boolean;
  autoCapitalize?: 'on' | 'off' | 'words' | 'sentences' | 'characters';
  /** id of a <datalist> to wire native autocomplete suggestions. */
  list?: string;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  icon: Icon,
  suffix,
  autoFocus,
  style,
  error,
  type = 'text',
  onKeyDown,
  onFocus,
  onBlur,
  disabled,
  autoComplete,
  spellCheck,
  autoCapitalize,
  list,
}: TextInputProps) {
  return (
    <div className="text-input-wrap" style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--s-2)',
      padding: '0 var(--s-2)',
      height: 32,
      background: 'var(--bg-1)',
      border: `1px solid ${error ? 'var(--danger)' : 'var(--line-2)'}`,
      borderRadius: 'var(--r-2)',
      transition: 'border-color var(--dur-fast)',
      opacity: disabled ? 0.5 : 1,
      ...style,
    }}>
      {Icon && <Icon size={13} strokeWidth={1.6} color="var(--fg-3)" />}
      <input
        type={type}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value ?? ''}
        onChange={e => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        list={list}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        autoCapitalize={autoCapitalize}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 0,
          outline: 'none',
          color: 'var(--fg-0)',
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          fontSize: 'var(--t-sm)',
          padding: 0,
        }}
      />
      {suffix && (
        <span style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
          {suffix}
        </span>
      )}
    </div>
  );
}

/* ===== Toggle (switch) ===== */
interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, size = 'md', disabled }: ToggleProps) {
  const w = size === 'sm' ? 28 : 34;
  const h = size === 'sm' ? 16 : 20;
  const k = h - 4;
  return (
    <label style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--s-2)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    }}>
      <span
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: w,
          height: h,
          borderRadius: 'var(--r-pill)',
          background: checked ? 'var(--accent)' : 'var(--bg-3)',
          border: `1px solid ${checked ? 'var(--accent)' : 'var(--line-3)'}`,
          position: 'relative',
          transition: 'background var(--dur-base), border-color var(--dur-base)',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute',
          top: 1,
          left: 1,
          width: k,
          height: k,
          borderRadius: '50%',
          background: checked ? 'var(--fg-on-accent)' : 'var(--fg-2)',
          // translateX, not animated `left` — `left` reflows each frame; transform composites cheaper
          transform: checked ? `translateX(${w - k - 4}px)` : 'translateX(0)',
          transition: 'transform var(--dur-base) var(--ease-std), background var(--dur-base)',
        }} />
      </span>
      {label && <span style={{ fontSize: 'var(--t-sm)' }}>{label}</span>}
    </label>
  );
}

/* ===== Checkbox ===== */
interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  size?: number;
  indeterminate?: boolean;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, size = 16, indeterminate, disabled }: CheckboxProps) {
  const filled = checked || indeterminate;
  return (
    <span
      role="checkbox"
      tabIndex={disabled ? -1 : 0}
      aria-checked={indeterminate ? 'mixed' : checked}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
      onKeyDown={(e) => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange(!checked); } }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 'var(--r-1)',
        background: filled ? 'var(--accent)' : 'transparent',
        border: `1px solid ${filled ? 'var(--accent)' : 'var(--line-3)'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        transition: 'background var(--dur-fast), border-color var(--dur-fast)',
      }}
    >
      {indeterminate ? (
        <span style={{ width: size * 0.5, height: 2, background: 'var(--fg-on-accent)' }} />
      ) : checked ? (
        <svg width={size - 4} height={size - 4} viewBox="0 0 24 24" fill="none" stroke="var(--fg-on-accent)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 12 10 18 20 6" />
        </svg>
      ) : null}
    </span>
  );
}
