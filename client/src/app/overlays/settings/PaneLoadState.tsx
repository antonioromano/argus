import { InlineErrorState, SkeletonRows, StaleNotice } from '../../../components/primitives/index.js';
import { useDelayedFlag } from '../../../hooks/useDelayedFlag.js';

interface PaneLoadStateProps {
  /** The list has answered at least once. */
  loaded: boolean;
  /** The last load's failure (null when it succeeded). */
  error: unknown;
  /** Headline for an error without a typed code, e.g. "Couldn’t load launchers". */
  errorTitle: string;
  /** Repeats the pane's load. */
  onRetry: () => void;
  /** Skeleton rows while the first load runs. */
  rows?: number;
  testId?: string;
}

/**
 * The non-data states of a settings pane's list (plan 2026-10-29-003, R1):
 * a skeleton once the first load has run 300 ms, the described error with
 * Retry when it failed, or a one-line stale notice when a reload failed over
 * data already shown. Renders nothing when loaded and fine: the pane draws
 * its own rows and its one-sentence empty line.
 */
export function PaneLoadState({ loaded, error, errorTitle, onRetry, rows = 3, testId }: PaneLoadStateProps) {
  const failed = error !== null && error !== undefined;
  const showSkeleton = useDelayedFlag(!loaded && !failed);
  if (failed && loaded) return <StaleNotice error={error} subject="the last list" onRetry={onRetry} />;
  if (failed) {
    return (
      <div className="setting-row" data-testid={testId}>
        <InlineErrorState error={error} fallbackTitle={errorTitle} onRetry={onRetry} />
      </div>
    );
  }
  if (!loaded && showSkeleton) return <SkeletonRows variant="list" count={rows} />;
  return null;
}
