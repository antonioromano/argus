import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip.js';
import { Icon } from './Icon.js';

interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: 'ghost' | 'outlined';
  size?: 'sm' | 'md';
  active?: boolean;
  /** Toggle buttons: exposes `active` as aria-pressed. */
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** false: no hover tooltip, for a self-explanatory glyph (a `…` menu). `label` stays the accessible name. */
  tooltip?: boolean;
}

export function IconButton({
  icon: Glyph,
  label,
  onClick,
  variant = 'ghost',
  size = 'md',
  active = false,
  pressed,
  disabled = false,
  className,
  style,
  tooltip = true,
}: IconButtonProps) {
  const dim = size === 'sm' ? 'var(--ctl-h-sm)' : 'var(--ctl-h-md)';
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
  const button = (
    <button
      aria-label={label}
      aria-pressed={pressed}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={btnClass}
      style={base}
    >
      <Icon icon={Glyph} size={iconSize} strokeWidth={1.6} />
    </button>
  );
  return tooltip ? <Tooltip content={label} position="top">{button}</Tooltip> : button;
}
