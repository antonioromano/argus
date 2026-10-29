import type { ReactNode } from 'react';
import { useDelayedFlag } from '../../hooks/useDelayedFlag.js';
import type { SurfaceState } from './surfaceState.js';
import { ErrorState, StaleNotice } from './States.js';

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
  state, skeleton, empty, error, errorTitle, errorSlot, staleSubject, onRetry, children,
}: SurfaceStatesProps) {
  const showSkeleton = useDelayedFlag(state === 'loading');
  switch (state) {
    case 'loading':
      return showSkeleton ? <>{skeleton}</> : null;
    case 'empty':
      return <>{empty ?? null}</>;
    case 'error':
      return <>{errorSlot ?? <ErrorState fallbackTitle={errorTitle} error={error ?? new Error(errorTitle ?? 'Unknown error')} onRetry={onRetry} />}</>;
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
