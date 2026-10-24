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

export function describePr(pr: SessionPr): string {
  const ci = pr.state === 'open' || pr.state === 'draft' ? ` · ${PR_CI_LABEL[pr.ci]}` : '';
  const repo = prRepo(pr.url);
  return `${PR_STATE_LABEL[pr.state]} PR ${repo ?? ''}#${pr.number}${ci} — click to open on GitHub`;
}

export const PR_REVIEW_LABEL: Record<PrReviewDecision, string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  review_required: 'review required',
  none: '',
};

export const isLivePr = (pr: SessionPr): boolean => pr.state === 'open' || pr.state === 'draft';

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
