import type { PrCiStatus, PrState, SessionPr } from '@argus/shared';

const STATE_LABEL: Record<PrState, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed' };
const CI_LABEL: Record<PrCiStatus, string> = {
  pending: 'checks running',
  success: 'checks passing',
  failure: 'checks failing',
  none: 'no checks',
};

export function describePr(pr: SessionPr): string {
  const ci = pr.state === 'open' || pr.state === 'draft' ? ` · ${CI_LABEL[pr.ci]}` : '';
  return `${STATE_LABEL[pr.state]} PR #${pr.number}${ci} — click to open on GitHub`;
}
