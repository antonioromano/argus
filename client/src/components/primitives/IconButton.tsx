import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip.js';

interface IconButtonProps {
  icon: LucideIcon;
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
  className,
  style,
}: IconButtonProps) {
  const dim = size === 'sm' ? 24 : 28;
  const iconSize = size === 'sm' ? 12 : 14;
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: dim,
    height: dim,
    borderRadius: 'var(--r-2)',
    border: variant === 'outlined' ? '1px solid var(--line-2)' : '1px solid transparent',
    background: active ? 'var(--bg-3)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--fg-2)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    transition: 'background var(--dur-fast) var(--ease-std), color var(--dur-fast)',
    flexShrink: 0,
    padding: 0,
    ...style,
  };
  const btnClass = [!disabled && !active ? 'hover-bg-3' : '', className].filter(Boolean).join(' ');
  return (
    <Tooltip content={label} position="top">
      <button
        aria-label={label}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        className={btnClass}
        style={base}
      >
        <Icon size={iconSize} strokeWidth={1.6} />
      </button>
    </Tooltip>
  );
}
