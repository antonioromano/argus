interface BadgeProps {
  label: string;
  color?: string;
  size?: 'sm' | 'md';
}

export function Badge({ label, color, size = 'sm' }: BadgeProps) {
  const fontSize = size === 'sm' ? 'var(--t-micro)' : 'var(--t-tiny)';
  const fgColor = color ?? 'var(--accent)';
  return (
    <span
      style={{
        fontSize,
        padding: size === 'sm' ? '1px 6px' : '2px 8px',
        borderRadius: 'var(--r-1)',
        background: 'var(--bg-3)',
        color: fgColor,
        fontFamily: 'var(--font-mono)',
        fontWeight: 500,
        letterSpacing: 'var(--tracking-eye)',
        textTransform: 'uppercase',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        display: 'inline-block',
        lineHeight: 1.2,
      }}
    >
      {label}
    </span>
  );
}
