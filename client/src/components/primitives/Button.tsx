import type { ReactNode } from 'react';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  children: ReactNode;
  style?: React.CSSProperties;
}

const VARIANTS: Record<string, React.CSSProperties> = {
  primary: {
    background: 'var(--color-btn-primary-bg)',
    color: 'var(--color-btn-primary-text)',
    border: 'none',
  },
  secondary: {
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border-subtle)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    border: 'none',
  },
  danger: {
    background: 'var(--color-error)',
    color: '#ffffff',
    border: 'none',
  },
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  children,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: size === 'sm' ? '4px 10px' : '8px 16px',
        fontSize: size === 'sm' ? 'var(--text-sm)' : 'var(--text-md)',
        borderRadius: 'var(--radius-sm)',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        fontWeight: 500,
        transition: `opacity var(--transition-fast), background var(--transition-fast)`,
        ...VARIANTS[variant],
        ...style,
      }}
      className={isDisabled ? '' : 'hover-opacity'}
    >
      {loading ? 'Loading…' : children}
    </button>
  );
}
