import type { PrTone, SessionPr, SessionPrSummary, SessionPrSummaryItem } from '@argus/shared';

/**
 * F5: the server's copy of the client's prTone (client/src/utils/prFormat.ts) —
 * a function, so it cannot be imported at runtime from shared. Keep the two in step.
 */
export function prTone(pr: SessionPr): PrTone {
  if (pr.state !== 'open') return pr.state;
  if (pr.mergeable === 'conflicting' || pr.ci === 'failure') return 'blocked';
  const reviewDone = pr.review !== 'review_required' && pr.review !== 'changes_requested';
  return pr.ci !== 'pending' && pr.mergeable === 'mergeable' && reviewDone ? 'ready' : 'pending';
}

/** Which tone the shell tab shows when a session has several PRs: the one
 *  that most needs the user's attention. Closed PRs are never counted. */
const TONE_PRIORITY: Exclude<PrTone, 'closed'>[] = ['blocked', 'pending', 'ready', 'draft', 'merged'];

/** One PR as the summary lists it. */
export function prSummaryItem(pr: SessionPr): SessionPrSummaryItem {
  return { url: pr.url, number: pr.number, state: pr.state, tone: prTone(pr), ...(pr.title ? { title: pr.title } : {}) };
}

/** The session's PRs (newest first) as the shell tab shows them; null when none is left once closed ones are dropped. */
export function summarizePrItems(all: readonly SessionPrSummaryItem[]): SessionPrSummary | null {
  const items = all.filter((i) => i.state !== 'closed');
  if (items.length === 0) return null;
  const tone = TONE_PRIORITY.find((t) => items.some((i) => i.tone === t)) ?? 'merged';
  return { count: items.length, tone, prs: items };
}

export const summarizePrs = (prs: readonly SessionPr[]): SessionPrSummary | null => summarizePrItems(prs.map(prSummaryItem));
