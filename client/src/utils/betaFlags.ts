import type { AppConfig, BetaFlag } from '@argus/shared';

/**
 * Whether a beta feature is switched on. Only an explicit `true` counts, so a
 * config that has not loaded yet, an older config file without the key, or a
 * malformed value all leave the feature off — and an off feature renders
 * nothing and starts nothing. Client twin of server `utils/betaFlags`.
 */
export function isBetaEnabled(config: Partial<AppConfig> | null | undefined, flag: BetaFlag): boolean {
  return config?.[flag] === true;
}

export interface BetaFeature {
  flag: BetaFlag;
  /** Review id from docs/reviews/2026-10-11-argus-review.md §6. */
  ref: string;
  label: string;
  description: string;
  /** False until the feature ships: its toggle stays disabled ("coming soon"),
   *  so nobody can switch on something that does nothing. */
  available: boolean;
}

export const BETA_FEATURES: readonly BetaFeature[] = [
  {
    flag: 'betaWorktreeLifecycle',
    ref: 'F8',
    label: 'Worktree lifecycle',
    description: 'Finish a worktree shell in one go — commit, push, open a PR — remove merged worktrees, and flag stale ones.',
    available: true,
  },
  {
    flag: 'betaActivityTimeline',
    ref: 'F6',
    label: 'Activity timeline',
    description: 'A per-shell timeline of tool calls, subagents and compactions from the agent hooks.',
    available: false,
  },
  {
    flag: 'betaSessionTemplates',
    ref: 'F10',
    label: 'Session templates',
    description: 'One link spawns several shells at once, each in its own worktree.',
    available: false,
  },
  {
    flag: 'betaHandoff',
    ref: 'F12',
    label: 'Agent handoff',
    description: 'Start a new shell seeded with a summary and the diff of another.',
    available: true,
  },
  {
    flag: 'betaSessionChains',
    ref: 'F13',
    label: 'Session chains',
    description: 'When one shell goes idle, send a prompt to another.',
    available: false,
  },
];
