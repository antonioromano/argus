import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip.js';

interface IconButtonProps {
  icon: LucideIcon;
  /** Used as aria-label and tooltip content. */
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: 'ghost' | 'outlined';
  size?: 'sm' | 'md';
  active?: boolean;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function IconButton({
  icon: Icon,
  label,
  onClick,
  variant = 'ghost',
  size = 'md',
  active = false,
  disabled = false,
  style,
}: IconButtonProps) {
  const dim = size === 'sm' ? 28 : 32;
  const iconSize = size === 'sm' ? 14 : 16;

  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: dim,
    height: dim,
    borderRadius: 'var(--radius-sm)',
    border: variant === 'outlined' ? 'none' : 'none',
    background: active ? 'var(--color-accent-subtle)' : 'transparent',
    color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    transition: `background var(--transition-fast), color var(--transition-fast)`,
    flexShrink: 0,
    padding: 0,
    ...style,
  };

  const hoverClass = variant === 'outlined' ? 'ghost-border' : '';
  const btnClass = [hoverClass, !disabled && !active ? 'hover-bg-surface' : ''].filter(Boolean).join(' ');

  return (
    <Tooltip content={label} position="top">
      <button
        aria-label={label}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        className={btnClass}
        style={base}
      >
        <Icon size={iconSize} strokeWidth={1.75} />
      </button>
    </Tooltip>
  );
}
