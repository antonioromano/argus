import type { PrTone, SessionInfo, SessionPrSummary } from '@argus/shared';
import { PR_STATE_LABEL, prRef, prTone } from '../../utils/prFormat.js';

const TONE_LABEL: Record<PrTone, string> = {
  blocked: 'needs attention',
  pending: 'in progress',
  ready: 'ready to merge',
  draft: 'draft',
  merged: 'merged',
  closed: 'closed',
};

/** The PRs the pill shows: the server's summary, else the one header PR
 *  (closed PRs are never shown). */
export function chipPrSummary(session: SessionInfo): SessionPrSummary | null {
  if (session.prSummary) return session.prSummary;
  const pr = session.pr;
  if (!pr || pr.state === 'closed') return null;
  const tone = prTone(pr);
  return { count: 1, tone, prs: [{ url: pr.url, number: pr.number, state: pr.state, tone, title: pr.title }] };
}

/** One tooltip line per PR: `owner/repo#42 · Open, ready to merge — Title`. */
export function describeChipPrs(summary: SessionPrSummary): string[] {
  return summary.prs.map((p) => {
    const tone = p.state === 'open' ? `, ${TONE_LABEL[p.tone]}` : '';
    return `${prRef(p.url, p.number)} · ${PR_STATE_LABEL[p.state]}${tone}${p.title ? ` — ${p.title}` : ''}`;
  });
}

/** The pill's class; `--running` while the session works (the sweep is in ChipMarks). */
export function chipClass(session: SessionInfo, extra?: string): string {
  return ['argus-chip', session.status === 'running' && 'argus-chip--running', extra].filter(Boolean).join(' ');
}
