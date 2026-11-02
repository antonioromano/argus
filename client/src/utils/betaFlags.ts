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
  /** Its page on the docs site: site/beta/<docsSlug>.md (check:docs-links pins it). */
  docsSlug: string;
}

export const BETA_FEATURES: readonly BetaFeature[] = [
  {
    flag: 'betaWorktreeLifecycle',
    ref: 'F8',
    label: 'Worktree lifecycle',
    description: 'Finish a worktree session in one go: commit, push, open a PR. Remove it once merged; stale worktrees get flagged.',
    how: 'Right-click a worktree session → Finish…',
    caveats: [{ text: 'Worktree sessions' }, { text: 'Uses gh if installed' }],
    docsSlug: 'worktree-lifecycle',
  },
  {
    flag: 'betaActivityTimeline',
    ref: 'F6',
    label: 'Activity timeline',
    description: 'A live feed of what the agent does: prompts, tool calls with their command or file, subagents, compactions.',
    how: 'Focus a session → Activity button in the header',
    caveats: [{ text: 'Claude only' }, { text: 'New or restarted sessions', warn: true }, { text: 'Last 500, not saved' }],
    docsSlug: 'activity-timeline',
  },
  {
    flag: 'betaSessionTemplates',
    ref: 'F10',
    label: 'Session templates',
    description: 'Save a set of sessions (agent, folder, optional new worktree, first prompt) and start them together into a new group.',
    how: 'Settings → Launchers → Templates, or ⌘K → “Launch template…”',
    caveats: [{ text: 'Up to 8 sessions' }],
    docsSlug: 'session-templates',
  },
  {
    flag: 'betaHandoff',
    ref: 'F12',
    label: 'Agent handoff',
    description: 'Start a new session seeded with a brief of another: its diff and last messages. No model call, no extra cost.',
    how: 'Right-click a session → Hand Off…',
    caveats: [],
    docsSlug: 'handoff',
  },
  {
    flag: 'betaSessionChains',
    ref: 'F13',
    label: 'Session chains',
    description: 'When one session goes idle, waiting or done, type a prompt into another.',
    how: 'Right-click a session → Chain to…',
    caveats: [{ text: 'Once by default' }, { text: 'Types into the target session', warn: true }, { text: 'Max 10/h per chain' }],
    docsSlug: 'session-chains',
  },
];
