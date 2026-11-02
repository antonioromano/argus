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
      className="eyebrow"
      style={{
        fontSize,
        padding: size === 'sm' ? 'var(--s-px) var(--s-1-5)' : 'var(--s-0-5) var(--s-2)',
        borderRadius: 'var(--r-1)',
        background: 'var(--bg-3)',
        color: fgColor,
        fontWeight: 500,
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
