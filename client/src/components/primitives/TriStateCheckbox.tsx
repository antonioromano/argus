import { Check } from 'lucide-react';

interface TriStateCheckboxProps {
  checked: boolean | 'indeterminate';
  onChange: () => void;
  size?: number;
  disabled?: boolean;
  label?: string;
}

export function TriStateCheckbox({ checked, onChange, size = 14, disabled = false, label }: TriStateCheckboxProps) {
  const isOn = checked === true;
  const isMixed = checked === 'indeterminate';
  const filled = isOn || isMixed;
  return (
    <span
      role="checkbox"
      tabIndex={disabled ? -1 : 0}
      aria-checked={isMixed ? 'mixed' : isOn}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(); }}
      onKeyDown={(e) => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange(); } }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        minWidth: size,
        borderRadius: 'var(--r-1)',
        background: filled ? 'var(--accent)' : 'transparent',
        border: `1px solid ${filled ? 'var(--accent)' : 'var(--line-3)'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--dur-fast), border-color var(--dur-fast)',
      }}
    >
      {isMixed ? (
        <span style={{ width: size * 0.5, height: 2, background: 'var(--fg-on-accent)' }} />
      ) : isOn ? (
        <Check size={size - 4} strokeWidth={2.5} color="var(--fg-on-accent)" />
      ) : null}
    </span>
  );
}
