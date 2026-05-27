import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Spinner } from './Spinner.js';

export type ButtonVariant = 'primary' | 'solid' | 'outline' | 'ghost' | 'danger' | 'secondary';

interface ButtonProps {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit' | 'reset';
  children?: ReactNode;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  danger?: boolean;
  full?: boolean;
  style?: React.CSSProperties;
  className?: string;
  title?: string;
  autoFocus?: boolean;
}

const PALETTE: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary:   { bg: 'transparent',       fg: 'var(--accent)',       border: 'var(--accent)' },
  solid:     { bg: 'var(--bg-3)',       fg: 'var(--fg-0)',         border: 'var(--line-2)' },
  outline:   { bg: 'transparent',       fg: 'var(--fg-0)',         border: 'var(--line-3)' },
  ghost:     { bg: 'transparent',       fg: 'var(--fg-1)',         border: 'transparent' },
  danger:    { bg: 'var(--danger-bg)',  fg: 'var(--danger)',       border: 'color-mix(in srgb, var(--danger) 33%, transparent)' },
  secondary: { bg: 'transparent',       fg: 'var(--fg-1)',         border: 'var(--line-2)' },
};

const SIZES: Record<'sm' | 'md' | 'lg', { padding: string; height: number; font: string }> = {
  sm: { padding: '0 var(--s-2)', height: 24, font: 'var(--t-xs)' },
  md: { padding: '0 var(--s-3)', height: 30, font: 'var(--t-sm)' },
  lg: { padding: '0 var(--s-4)', height: 36, font: 'var(--t-base)' },
};

export function Button({
  variant = 'ghost',
  size = 'md',
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  children,
  icon: Icon,
  iconRight: IconRight,
  danger,
  full,
  style,
  className,
  title,
  autoFocus,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const p = danger ? PALETTE.danger : PALETTE[variant];
  const s = SIZES[size];
  const iconSize = size === 'sm' ? 12 : 14;
  const isFilled = variant === 'primary' || variant === 'solid' || danger;
  return (
    <button
      type={type}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      title={title}
      autoFocus={autoFocus}
      className={`${isDisabled ? '' : 'btn-press'} ${className ?? ''}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: s.padding,
        height: s.height,
        background: p.bg,
        color: p.fg,
        border: `1px solid ${p.border}`,
        borderRadius: 'var(--r-2)',
        fontFamily: isFilled ? 'var(--font-sans)' : 'var(--font-mono)',
        fontSize: s.font,
        fontWeight: variant === 'primary' ? 600 : 500,
        letterSpacing: isFilled ? 0 : '0.02em',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.5 : 1,
        width: full ? '100%' : 'auto',
        whiteSpace: 'nowrap',
        transition: 'background var(--dur-fast) var(--ease-std), color var(--dur-fast), opacity var(--dur-fast)',
        ...style,
      }}
    >
      {loading ? <Spinner size={iconSize} /> : (Icon && <Icon size={iconSize} strokeWidth={1.6} />)}
      {children}
      {IconRight && <IconRight size={iconSize} strokeWidth={1.6} />}
    </button>
  );
}
