import { useEffect, useRef } from 'react';

interface TriStateCheckboxProps {
  checked: boolean | 'indeterminate';
  onChange: () => void;
  size?: number;
  disabled?: boolean;
  label?: string;
}

export function TriStateCheckbox({ checked, onChange, size = 13, disabled = false, label }: TriStateCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.indeterminate = checked === 'indeterminate';
  }, [checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked === true}
      onChange={onChange}
      onClick={e => e.stopPropagation()}
      disabled={disabled}
      aria-checked={checked === 'indeterminate' ? 'mixed' : checked}
      aria-label={label}
      style={{
        width: size,
        height: size,
        minWidth: size,
        cursor: disabled ? 'not-allowed' : 'pointer',
        accentColor: 'var(--color-accent)',
        flexShrink: 0,
      }}
    />
  );
}
