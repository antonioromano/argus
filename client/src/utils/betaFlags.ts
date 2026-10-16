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
  /** Where to find it once it is on — shown as the HOW line. */
  how: string;
  /** Limits worth knowing before turning it on; `warn` marks the ones with side effects. */
  caveats: readonly { text: string; warn?: boolean }[];
}

export const BETA_FEATURES: readonly BetaFeature[] = [
  {
    flag: 'betaWorktreeLifecycle',
    ref: 'F8',
    label: 'Worktree lifecycle',
    description: 'Finish a worktree shell in one go: commit, push, open a PR. Remove it once merged; stale worktrees get flagged.',
    how: 'Right-click a worktree shell → Finish…',
    caveats: [{ text: 'Worktree shells' }, { text: 'Uses gh if installed' }],
  },
  {
    flag: 'betaActivityTimeline',
    ref: 'F6',
    label: 'Activity timeline',
    description: 'A live feed of what the agent does: prompts, tool calls with their command or file, subagents, compactions.',
    how: 'Focus a shell → Activity button in the header',
    caveats: [{ text: 'Claude only' }, { text: 'New or restarted shells', warn: true }, { text: 'Last 500, not saved' }],
  },
  {
    flag: 'betaSessionTemplates',
    ref: 'F10',
    label: 'Session templates',
    description: 'Save a set of shells (agent, folder, optional new worktree, first prompt) and start them together into a new group.',
    how: 'Settings → Launchers → Templates, or ⌘K → “Launch template…”',
    caveats: [{ text: 'Up to 8 shells' }],
  },
  {
    flag: 'betaHandoff',
    ref: 'F12',
    label: 'Agent handoff',
    description: 'Start a new shell seeded with a brief of another: its diff and last messages. No model call, no extra cost.',
    how: 'Right-click a shell → Hand off…',
    caveats: [],
  },
  {
    flag: 'betaSessionChains',
    ref: 'F13',
    label: 'Session chains',
    description: 'When one shell goes idle, waiting or done, type a prompt into another.',
    how: 'Right-click a shell → Chain to…',
    caveats: [{ text: 'Once by default' }, { text: 'Types into the target shell', warn: true }, { text: 'Max 10/h per chain' }],
  },
];
