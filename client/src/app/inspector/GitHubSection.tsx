import { ExternalLink, FileDiff } from 'lucide-react';
import type { SessionPrEntry } from '@argus/shared';
import { Icon } from '../../components/primitives/index.js';
import { openExternal } from '../../utils/openExternal.js';
import {
  PR_CI_LABEL, PR_REVIEW_LABEL, PR_STATE_ICON, PR_STATE_LABEL, isLivePr, prNumberOf, prRef, summarizePrStates, worstCi,
} from '../../utils/prFormat.js';
import { useLastSessionPrs, useSessionPrs } from '../../hooks/useSessionPrs.js';
import type { InspectorContext, InspectorSectionProps } from './types.js';
import { InspectorEmpty } from './InspectorRow.js';

/**
 * What the card shows before (or instead of) the full list: the header chip's
 * PR. It may be the folder's PR or the conversation's latest, so no marker.
 */
function chipEntries(session: InspectorSectionProps['session']): SessionPrEntry[] {
  return session.pr ? [{ url: session.pr.url, pr: session.pr, folderBranch: false, linked: false }] : [];
}

/**
 * One PR: title (opens it on GitHub), `owner/repo#n`, state, checks, review
 * and mergeability. B4 extension point: when `ctx.onOpenPrDiff` is wired the
 * row offers "Files" to open the PR's changed files and diff.
 */
export function PrRow({ entry, sessionId, ctx }: { entry: SessionPrEntry; sessionId: string; ctx: InspectorContext }) {
  const { pr, url } = entry;
  const ref = prRef(url, pr?.number);
  const live = !!pr && isLivePr(pr);
  return (
    <li className="argus-inspector-prrow" data-state={pr?.state ?? 'unknown'}>
      <button type="button" className="argus-inspector-pr" data-state={pr?.state} onClick={() => openExternal(url)} title={`Open ${ref} on GitHub`}>
        {pr && <Icon icon={PR_STATE_ICON[pr.state]} size={13} strokeWidth={2} className="argus-pr-icon" style={{ flexShrink: 0 }} />}
        <span className="argus-inspector-pr-title">{pr?.title || ref}</span>
        <Icon icon={ExternalLink} size={11} strokeWidth={1.8} style={{ flexShrink: 0, marginLeft: 'auto' }} />
      </button>
      <div className="argus-inspector-pr-meta">
        {pr?.title && <span className="argus-inspector-ellipsis">{ref}</span>}
        {pr ? (
          <span className="argus-inspector-pr-badge" data-tone={pr.state}>{PR_STATE_LABEL[pr.state]}</span>
        ) : (
          <span className="argus-inspector-dim">status unavailable</span>
        )}
        {live && (
          <span className="argus-inspector-ci" data-ci={pr.ci}>
            {pr.ci !== 'none' && <span className="argus-pr-ci" data-ci={pr.ci} aria-hidden />}
            {PR_CI_LABEL[pr.ci]}
          </span>
        )}
        {live && pr.review && pr.review !== 'none' && (
          <span className="argus-inspector-pr-review" data-review={pr.review}>{PR_REVIEW_LABEL[pr.review]}</span>
        )}
        {live && pr.mergeable === 'conflicting' && <span className="argus-inspector-pr-conflict">conflicts</span>}
        {entry.folderBranch && (
          <span className="argus-inspector-tag" title={pr?.branch ? `PR of ${pr.branch}, the branch checked out in the session folder` : undefined}>
            this branch
          </span>
        )}
        {ctx.onOpenPrDiff && (
          <button type="button" className="argus-inspector-link argus-inspector-pr-files" onClick={() => ctx.onOpenPrDiff!(sessionId, entry)}>
            <Icon icon={FileDiff} size={11} strokeWidth={1.8} />
            Files
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Every PR of the session (B3), newest first: the ones its conversations
 * created or pushed to, plus the PR of the folder's branch (marked). Fetched
 * only while the card is open.
 */
export function GitHubBody({ session, ctx }: InspectorSectionProps) {
  const refreshKey = session.pr ? `${session.pr.url}|${session.pr.state}|${session.pr.ci}` : '';
  const { prs, enabled, error } = useSessionPrs(session.id, ctx.prStatusEnabled, refreshKey);
  if (!ctx.prStatusEnabled || !enabled) return <InspectorEmpty>Pull request status is off (Settings → Shell header).</InspectorEmpty>;

  const list = prs ?? chipEntries(session);
  if (list.length === 0) {
    if (prs === undefined) return <InspectorEmpty>{error ? `Couldn’t read pull requests: ${error}` : 'Looking for pull requests…'}</InspectorEmpty>;
    return <InspectorEmpty>No pull request for this session.</InspectorEmpty>;
  }
  return (
    <>
      {error && prs && <InspectorEmpty>Couldn’t refresh pull requests ({error}); showing the last reading.</InspectorEmpty>}
      <ul className="argus-inspector-prs" aria-label="Pull requests">
        {list.map((entry) => <PrRow key={entry.url} entry={entry} sessionId={session.id} ctx={ctx} />)}
      </ul>
    </>
  );
}

/**
 * The list the card last read with the header chip's PR — which the server
 * sweep keeps live — laid over it, so a collapsed card's glance follows the
 * chip instead of freezing at the last reading. A chip PR the list doesn't
 * have yet goes on top (it is the newest).
 */
function withLiveChip(remembered: readonly SessionPrEntry[] | undefined, session: InspectorSectionProps['session']): SessionPrEntry[] {
  const chip = session.pr;
  if (!remembered || remembered.length === 0) return chipEntries(session);
  if (!chip) return [...remembered];
  const key = chip.url.toLowerCase();
  let found = false;
  const list = remembered.map((e) => {
    if (e.url.toLowerCase() !== key) return e;
    found = true;
    return { ...e, pr: chip };
  });
  return found ? list : [chipEntries(session)[0], ...list];
}

/**
 * Collapsed-header glance, no fetch: the list the card last read, with the
 * live header chip's PR merged in (see withLiveChip). One PR → its number; several → a count. Either way the
 * dot is the worst checks state of the PRs still open.
 */
export function GitHubGlance({ session, ctx }: InspectorSectionProps) {
  const remembered = useLastSessionPrs(session.id);
  if (!ctx.prStatusEnabled) return null;
  const list = withLiveChip(remembered, session);
  if (list.length === 0) return null;
  const prs = list.map((e) => e.pr);
  const ci = worstCi(prs);
  const only = list.length === 1 ? list[0] : null;
  return (
    <span
      className="argus-inspector-ci"
      data-state={only?.pr?.state}
      title={`${summarizePrStates(prs)}${ci !== 'none' ? ` · ${PR_CI_LABEL[ci]}` : ''}`}
    >
      {only ? `#${only.pr?.number ?? prNumberOf(only.url)}` : `${list.length} PRs`}
      {ci !== 'none' && <span className="argus-pr-ci" data-ci={ci} aria-hidden />}
    </span>
  );
}
