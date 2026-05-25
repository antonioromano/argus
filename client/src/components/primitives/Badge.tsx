interface BadgeProps {
  label: string;
  /** CSS color value or var(--color-*) token. Defaults to accent color. */
  color?: string;
  size?: 'sm' | 'md';
}

export function Badge({ label, color, size = 'sm' }: BadgeProps) {
  const fontSize = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)';
  const fgColor = color ?? 'var(--color-accent)';

  return (
    <span
      style={{
        fontSize,
        padding: size === 'sm' ? '1px 6px' : '2px 8px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface-high, var(--color-bg-surface))',
        color: fgColor,
        fontFamily: 'var(--font-mono)',
        fontWeight: 500,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {label}
    </span>
  );
}
