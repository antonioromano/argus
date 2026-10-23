import type { PrCiStatus, PrState, SessionPr } from '@argus/shared';

const STATE_LABEL: Record<PrState, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' };
const CI_LABEL: Record<PrCiStatus, string> = {
  pending: 'checks running',
  success: 'checks passing',
  failure: 'checks failing',
  none: 'no checks',
};

/** `owner/repo` of a github.com PR URL — the chip can show a PR from another
 *  repo than the session folder (one the conversation created or pushed to). */
function repoOf(url: string): string | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url);
  return m ? m[1] : null;
}

export function describePr(pr: SessionPr): string {
  const ci = pr.state === 'open' || pr.state === 'draft' ? ` · ${CI_LABEL[pr.ci]}` : '';
  const repo = repoOf(pr.url);
  return `${STATE_LABEL[pr.state]} PR ${repo ?? ''}#${pr.number}${ci} — click to open on GitHub`;
}
