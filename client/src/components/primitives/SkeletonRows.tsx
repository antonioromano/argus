export type SkeletonVariant = 'list' | 'tree' | 'diff' | 'inline';

interface SkeletonRowsProps {
  /** Rows to draw. */
  count?: number;
  /** Shape of the content it stands in for. */
  variant?: SkeletonVariant;
}

/**
 * Placeholder rows shaped like the content that is loading. Bar widths and
 * indents come from CSS `nth-child` cycles (index.css, `.argus-skeleton-*`),
 * so they are deterministic and the component has no inline styles. The
 * shimmer stops under prefers-reduced-motion. Show it through
 * `useDelayedFlag` / `SurfaceStates` so fast loads never flash it.
 */
export function SkeletonRows({ count = 5, variant = 'list' }: SkeletonRowsProps) {
  return (
    <div className="argus-skeleton-rows" data-variant={variant} aria-hidden="true">
      {Array.from({ length: Math.max(0, count) }, (_, i) => (
        <div key={i} className="argus-skeleton-row">
          {variant === 'diff' && <span className="argus-skeleton-bar argus-skeleton-gutter" />}
          <span className="argus-skeleton-bar" />
        </div>
      ))}
    </div>
  );
}
