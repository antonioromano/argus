import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react';
import type { PrCiStatus, PrReviewDecision, PrState, SessionPr } from '@argus/shared';

/** Glyph per PR state, shared by the header chip and the Session Inspector. */
export const PR_STATE_ICON = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
} as const satisfies Record<PrState, unknown>;

export const PR_STATE_LABEL: Record<PrState, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' };
export const PR_CI_LABEL: Record<PrCiStatus, string> = {
  pending: 'checks running',
  success: 'checks passing',
  failure: 'checks failing',
  none: 'no checks',
};

/** `owner/repo` of a github.com PR URL — the chip can show a PR from another
 *  repo than the session folder (one the conversation created or pushed to). */
export function prRepo(url: string): string | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url);
  return m ? m[1] : null;
}

/** Number of a PR URL (`…/pull/42` → 42); 0 when it has none. */
export function prNumberOf(url: string): number {
  return Number(/\/pull\/(\d+)$/.exec(url)?.[1] ?? 0);
}

/** `owner/repo#n` of a PR URL (just `#n` when the URL is not github.com). */
export function prRef(url: string, number = prNumberOf(url)): string {
  const repo = prRepo(url);
  return repo ? `${repo}#${number}` : `#${number}`;
}

export function describePr(pr: SessionPr): string {
  const ci = pr.state === 'open' || pr.state === 'draft' ? ` · ${PR_CI_LABEL[pr.ci]}` : '';
  return `${PR_STATE_LABEL[pr.state]} PR ${prRef(pr.url, pr.number)}${ci} — click to open on GitHub`;
}

export const PR_REVIEW_LABEL: Record<PrReviewDecision, string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  review_required: 'review required',
  none: '',
};

export const isLivePr = (pr: SessionPr): boolean => pr.state === 'open' || pr.state === 'draft';

/**
 * The color a PR is shown in: merged purple, closed red, draft grey. An open
 * PR is amber when it can't be merged (conflicts or failing checks), green
 * when it is ready (checks passed or none, mergeable, no review outstanding)
 * and grey-blue while it is still on its way (checks running, review asked
 * for, mergeability not computed yet). A draft stays grey whatever its checks say.
 */
export type PrTone = 'ready' | 'pending' | 'blocked' | 'draft' | 'merged' | 'closed';

/** prTone as a color token, for glyphs styled inline (the CSS rules use data-tone). */
export const PR_TONE_COLOR: Record<PrTone, string> = {
  ready: 'var(--ok)',
  pending: 'var(--pr-pending)',
  blocked: 'var(--accent)',
  draft: 'var(--fg-3)',
  merged: 'var(--pr-merged)',
  closed: 'var(--danger)',
};

export function prTone(pr: SessionPr): PrTone {
  if (pr.state !== 'open') return pr.state;
  if (pr.mergeable === 'conflicting' || pr.ci === 'failure') return 'blocked';
  const reviewDone = pr.review !== 'review_required' && pr.review !== 'changes_requested';
  return pr.ci !== 'pending' && pr.mergeable === 'mergeable' && reviewDone ? 'ready' : 'pending';
}

const CI_RANK: Record<PrCiStatus, number> = { none: 0, success: 1, pending: 2, failure: 3 };

/** Worst checks state over the PRs still open (merged/closed checks no longer
 *  matter): any failure, else anything running, else passing; none when no
 *  open PR has checks. */
export function worstCi(prs: readonly (SessionPr | null)[]): PrCiStatus {
  let worst: PrCiStatus = 'none';
  for (const pr of prs) {
    if (pr && isLivePr(pr) && CI_RANK[pr.ci] > CI_RANK[worst]) worst = pr.ci;
  }
  return worst;
}

/** "2 open, 1 merged" — counts per state, in lifecycle order, unknown last. */
export function summarizePrStates(prs: readonly (SessionPr | null)[]): string {
  const counts = new Map<PrState | 'unknown', number>();
  for (const pr of prs) {
    const k = pr ? pr.state : 'unknown';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const order: (PrState | 'unknown')[] = ['open', 'draft', 'merged', 'closed', 'unknown'];
  return order.filter((k) => counts.has(k)).map((k) => `${counts.get(k)} ${k}`).join(', ');
}

/**
 * C1: one-line checks summary for the CI dot's tooltip — "CI: all checks
 * passed", "CI: 1 failed, 2 pending". Falls back to the aggregate when the
 * per-outcome counts are missing (an answer from an older server).
 */
export function ciSummary(pr: SessionPr): string {
  if (pr.ci === 'none') return 'CI: no checks';
  const c = pr.checks?.counts;
  if (!c) return `CI: ${PR_CI_LABEL[pr.ci]}`;
  const parts: string[] = [];
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.pending) parts.push(`${c.pending} pending`);
  if (parts.length > 0) return `CI: ${parts.join(', ')}`;
  return c.skipped ? `CI: all checks passed (${c.skipped} skipped)` : 'CI: all checks passed';
}

/** C1: GitHub's checks tab of a PR. */
export const prChecksUrl = (url: string): string => `${url.replace(/\/+$/, '')}/checks`;

const COUNT = new Intl.NumberFormat('en-US');
/** C2: a line count as the row's diff button shows it (`4,024`). */
export const formatLines = (n: number): string => COUNT.format(n);
