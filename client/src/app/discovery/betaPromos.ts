import { Activity, Flag, Forward, Link2, type LucideIcon } from 'lucide-react';
import type { AppConfig, BetaFlag, DiscoveryState, SessionInfo } from '@argus/shared';
import { isBetaEnabled } from '../../utils/betaFlags.js';

/**
 * "Try … (beta)" suggestions: a beta feature offered in the session menu of a
 * session it would actually help, one click to switch it on and use it. Pure
 * data; ArgusApp wires each flag to the feature's real opener.
 */
export interface BetaPromo {
  flag: BetaFlag;
  label: string;
  /** The caveat worth knowing before trying it (from BETA_FEATURES). */
  hint: string;
  icon: LucideIcon;
}

/** "Hide beta suggestions" writes this into `betaPromosHidden`. */
export const HIDE_ALL_PROMOS = '*';
/** Keep the menu short. */
export const MAX_PROMOS_PER_MENU = 2;

const SESSION_PROMOS: readonly (BetaPromo & { fits: (s: SessionInfo, liveCount: number) => boolean })[] = [
  {
    flag: 'betaHandoff', label: 'Hand off to a new session', hint: 'Beta · no model call', icon: Forward,
    fits: (s) => s.status !== 'exited',
  },
  {
    flag: 'betaSessionChains', label: 'Chain to another session', hint: 'Beta · types into the target session', icon: Link2,
    fits: (s, live) => s.status !== 'exited' && live >= 2,
  },
  {
    flag: 'betaWorktreeLifecycle', label: 'Finish worktree (commit, push, PR)', hint: 'Beta · uses gh if installed', icon: Flag,
    fits: (s) => !!s.worktreePath && !!s.worktreeBranch,
  },
  {
    flag: 'betaActivityTimeline', label: 'Show activity timeline', hint: 'Beta · new or restarted sessions', icon: Activity,
    fits: (s) => s.agentType === 'claude',
  },
];

export function promoHidden(discovery: DiscoveryState, flag: BetaFlag): boolean {
  return discovery.betaPromosHidden.includes(HIDE_ALL_PROMOS) || discovery.betaPromosHidden.includes(flag);
}

/** The promos that fit this session: flag off, not dismissed, at most two. */
export function promosFor(
  session: SessionInfo,
  { config, liveCount, discovery }: { config: AppConfig | null; liveCount: number; discovery: DiscoveryState },
): BetaPromo[] {
  return SESSION_PROMOS
    .filter((p) => !isBetaEnabled(config, p.flag) && !promoHidden(discovery, p.flag) && p.fits(session, liveCount))
    .slice(0, MAX_PROMOS_PER_MENU)
    .map(({ flag, label, hint, icon }) => ({ flag, label, hint, icon }));
}

/** Session templates aren't session-scoped: offered once on the empty Landing. */
export function templatesPromoVisible(config: AppConfig | null, discovery: DiscoveryState): boolean {
  return !!config && !isBetaEnabled(config, 'betaSessionTemplates') && !promoHidden(discovery, 'betaSessionTemplates');
}

export interface PromoDeps {
  enable: (flag: BetaFlag) => Promise<unknown>;
  openHandoff: (s: SessionInfo) => void;
  openChain: (s: SessionInfo) => void;
  openFinish: (s: SessionInfo) => void;
  openActivity: (s: SessionInfo) => void;
  toast: (message: string) => void;
}

/** Turn the flag on, then do what the entry promised on this session. */
export async function runBetaPromo(promo: Pick<BetaPromo, 'flag' | 'label'>, s: SessionInfo, d: PromoDeps): Promise<void> {
  await d.enable(promo.flag);
  if (promo.flag === 'betaActivityTimeline') {
    d.openActivity(s);
    // The caveat that matters right now: hooks attach at spawn.
    d.toast('Activity timeline is on. Restart the session to start recording.');
    return;
  }
  if (promo.flag === 'betaHandoff') d.openHandoff(s);
  else if (promo.flag === 'betaSessionChains') d.openChain(s);
  else if (promo.flag === 'betaWorktreeLifecycle') d.openFinish(s);
  d.toast(`${promo.label} (beta) is on. Turn it off in Settings → Beta.`);
}
