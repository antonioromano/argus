import type { ReactNode } from 'react';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  children: ReactNode;
  style?: React.CSSProperties;
}

const VARIANTS: Record<string, { style: React.CSSProperties; fontWeight: number }> = {
  primary: {
    style: {
      background: 'var(--color-accent)',
      color: 'var(--color-btn-primary-text)',
      border: 'none',
    },
    fontWeight: 600,
  },
  secondary: {
    style: {
      background: 'transparent',
      color: 'var(--color-text-secondary)',
      border: '1px solid var(--color-border-subtle)',
    },
    fontWeight: 500,
  },
  ghost: {
    style: {
      background: 'transparent',
      color: 'var(--color-text-secondary)',
      border: 'none',
    },
    fontWeight: 400,
  },
  danger: {
    style: {
      background: 'var(--color-error)',
      color: '#ffffff',
      border: 'none',
    },
    fontWeight: 600,
  },
};

const SIZE_PADDING: Record<'sm' | 'md' | 'lg', string> = {
  sm: '4px 10px',
  md: '8px 16px',
  lg: '10px 20px',
};

const SIZE_FONT: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'var(--text-sm)',
  md: 'var(--text-md)',
  lg: 'var(--text-md)',
};

const SIZE_MIN_HEIGHT: Record<'sm' | 'md' | 'lg', number> = {
  sm: 24,
  md: 28,
  lg: 32,
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
  const v = VARIANTS[variant];

  return (
    <button
      type={type}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: SIZE_PADDING[size],
        fontSize: SIZE_FONT[size],
        minHeight: SIZE_MIN_HEIGHT[size],
        borderRadius: 'var(--radius-lg)',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        fontWeight: v.fontWeight,
        transition: 'opacity var(--transition-fast), background var(--transition-fast), transform var(--transition-fast)',
        fontFamily: 'var(--font-sans)',
        ...v.style,
        ...style,
      }}
      className={isDisabled ? '' : 'btn-press hover-opacity'}
    >
      {loading ? 'Loading…' : children}
    </button>
  );
}
