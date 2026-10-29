import type { ReactNode } from 'react';
import { useDelayedFlag } from '../../hooks/useDelayedFlag.js';
import type { SurfaceState } from './surfaceState.js';
import { ErrorState, InlineErrorState, StaleNotice } from './States.js';

interface SurfaceStatesProps {
  /** From `deriveSurfaceState`. */
  state: SurfaceState;
  /** Shown once loading has lasted 300 ms (usually `<SkeletonRows …/>`). */
  skeleton: ReactNode;
  /** Empty slot: one sentence, at most one action (`<EmptyState …/>` or a line). */
  empty?: ReactNode;
  /** The failure behind `error` / `stale`. */
  error?: unknown;
  /** Headline for an error without a typed code, e.g. "Couldn’t load activity". */
  errorTitle?: string;
  /** Replaces the default ErrorState (for surfaces with their own error UI). */
  errorSlot?: ReactNode;
  /** 'inline' for a section inside a larger surface (settings pane, inspector):
   *  left-aligned, not centred. Default 'block'. */
  errorVariant?: 'block' | 'inline';
  /** What `stale` keeps, for its notice ("the last reading"). */
  staleSubject?: string;
  /** Repeats the load; wires Retry in the error and stale states. */
  onRetry?: () => void;
  /** The data (`ready` and `stale`). */
  children?: ReactNode;
}

/**
 * One switch for a data surface's five states (plan 2026-10-29-003, R1),
 * instead of nested ternaries per surface. Loading renders nothing for the
 * first 300 ms, then the skeleton.
 */
export function SurfaceStates({
  state, skeleton, empty, error, errorTitle, errorSlot, errorVariant = 'block', staleSubject, onRetry, children,
}: SurfaceStatesProps) {
  const showSkeleton = useDelayedFlag(state === 'loading');
  switch (state) {
    case 'loading':
      return showSkeleton ? <>{skeleton}</> : null;
    case 'empty':
      return <>{empty ?? null}</>;
    case 'error': {
      if (errorSlot) return <>{errorSlot}</>;
      const failure = error ?? new Error(errorTitle ?? 'Unknown error');
      return errorVariant === 'inline'
        ? <InlineErrorState fallbackTitle={errorTitle} error={failure} onRetry={onRetry} />
        : <ErrorState fallbackTitle={errorTitle} error={failure} onRetry={onRetry} />;
    }
    case 'stale':
      return (
        <>
          <StaleNotice error={error} subject={staleSubject} onRetry={onRetry} />
          {children}
        </>
      );
    case 'ready':
      return <>{children}</>;
  }
}
