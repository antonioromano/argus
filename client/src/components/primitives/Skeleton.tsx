interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
}

export function Skeleton({ width = '100%', height = 8, borderRadius = 'var(--r-1)' }: SkeletonProps) {
  return (
    <span
      style={{
        display: 'inline-block',
        width,
        height,
        borderRadius,
        background: 'linear-gradient(90deg, var(--bg-2), var(--bg-3), var(--bg-2))',
        backgroundSize: '200% 100%',
        animation: 'argus-shimmer 1.4s linear infinite',
      }}
    />
  );
}

