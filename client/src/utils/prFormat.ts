import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react';
import type { PrCiStatus, PrState, SessionPr } from '@argus/shared';

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
