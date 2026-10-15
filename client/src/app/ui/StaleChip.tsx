import { Tooltip } from '../../components/primitives/index.js';

/**
 * Beta F8: the "stale" marker beside a worktree shell's branch. The server
 * only sends `staleDays` while `betaWorktreeLifecycle` is on, so with the flag
 * off this never renders.
 */
export function StaleChip({ staleDays }: { staleDays?: number }) {
  if (staleDays === undefined) return null;
  return (
    <Tooltip content={`No commit on this branch for ${staleDays} days`}>
      <span className="argus-tile-stale" data-testid="stale-chip">stale</span>
    </Tooltip>
  );
}
