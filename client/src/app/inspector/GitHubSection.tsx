import { useState } from 'react';
import { ExternalLink, FileDiff, GitPullRequest, GitPullRequestArrow } from 'lucide-react';
import type { SessionPrEntry } from '@argus/shared';
import { Icon, pushToast } from '../../components/primitives/index.js';
import { api } from '../../services/api.js';
import { openExternal } from '../../utils/openExternal.js';
import {
  PR_CI_LABEL, PR_REVIEW_LABEL, formatLines, PR_STATE_ICON, PR_STATE_LABEL, isLivePr, prNumberOf, prRef, prTone, summarizePrStates, worstCi,
} from '../../utils/prFormat.js';
import { useLastSessionPrs, useSessionPrs } from '../../hooks/useSessionPrs.js';
import type { InspectorContext, InspectorSectionProps } from './types.js';
import { InspectorEmpty } from './InspectorRow.js';
import { CiStatus } from './CiMonitor.js';

/**
 * What the card shows before (or instead of) the full list: the header chip's
 * PR. It may be the folder's PR or the conversation's latest, so no marker.
 */
function chipEntries(session: InspectorSectionProps['session']): SessionPrEntry[] {
  return session.pr ? [{ url: session.pr.url, pr: session.pr, folderBranch: false, linked: false }] : [];
}

/**
 * One PR: state glyph, title (opens it on GitHub), `owner/repo#n`, then a
 * status line — state, checks (C1: a dot that opens the CI monitoring
 * popover), review, mergeability, "this branch". When
 * `ctx.onOpenPrDiff` is wired (B4) the row offers its changes — C2: as
 * `+N −M`, the lines the PR adds and deletes ("Changed files" until gh says).
 * A draft offers Mark ready (C3).
 */
export function PrRow({ entry, sessionId, ctx, onChanged }: {
  entry: SessionPrEntry;
  sessionId: string;
  ctx: InspectorContext;
  /** The PR was changed from here (C3): read the list again. */
  onChanged?: () => void;
}) {
  const { pr, url } = entry;
  const ref = prRef(url, pr?.number);
  const live = !!pr && isLivePr(pr);
  const [busy, setBusy] = useState(false);

  /** C3: `gh pr ready` / `--undo` through the server; gh's error becomes a toast. */
  const setReady = async (ready: boolean) => {
    setBusy(true);
    try {
      await api.setSessionPrReady(sessionId, url, ready);
      pushToast(ready ? `${ref} is ready for review` : `${ref} is a draft again`, 'ok');
    } catch (err) {
      pushToast(`Couldn’t ${ready ? 'mark' : 'convert'} ${ref}${ready ? ' ready' : ' to draft'}: ${err instanceof Error ? err.message : String(err)}`, 'danger');
    } finally {
      setBusy(false);
      onChanged?.();
    }
  };
  return (
    <li className="argus-inspector-prrow" data-state={pr?.state ?? 'unknown'} data-tone={pr ? prTone(pr) : undefined}>
      <Icon icon={pr ? PR_STATE_ICON[pr.state] : GitPullRequest} size={14} strokeWidth={2} className="argus-inspector-pr-glyph" />
      <div className="argus-inspector-pr-body">
        <button type="button" className="argus-inspector-pr" onClick={() => openExternal(url)} title={`Open ${ref} on GitHub`}>
          <span className="argus-inspector-pr-title">{pr?.title || ref}</span>
          <Icon icon={ExternalLink} size={11} strokeWidth={1.8} className="argus-inspector-pr-ext" />
        </button>
        {pr?.title && <span className="argus-inspector-pr-ref">{ref}</span>}
        <div className="argus-inspector-pr-meta">
          {pr ? (
            <span className="argus-inspector-pr-badge" data-tone={prTone(pr)}>{PR_STATE_LABEL[pr.state]}</span>
          ) : (
            <span>status unavailable</span>
          )}
          {live && <CiStatus pr={pr} />}
          {live && pr.review && pr.review !== 'none' && (
            <span className="argus-inspector-pr-review" data-review={pr.review}>{PR_REVIEW_LABEL[pr.review]}</span>
          )}
          {live && pr.mergeable === 'conflicting' && <span className="argus-inspector-pr-conflict">conflicts</span>}
          {entry.folderBranch && (
            <span title={pr?.branch ? `PR of ${pr.branch}, the branch checked out in the session folder` : undefined}>this branch</span>
          )}
        </div>
        {pr?.state === 'draft' && (
          <button
            type="button"
            className="argus-inspector-pr-ready"
            disabled={busy}
            aria-busy={busy || undefined}
            title={`Mark ${ref} ready for review`}
            onClick={() => { void setReady(true); }}
          >
            <Icon icon={GitPullRequestArrow} size={12} strokeWidth={1.8} />
            {busy ? 'Marking ready…' : 'Mark ready'}
          </button>
        )}
        {ctx.onOpenPrDiff && (
          <button type="button" className="argus-inspector-pr-files" title="Open changes" onClick={() => ctx.onOpenPrDiff!(sessionId, entry)}>
            <Icon icon={FileDiff} size={12} strokeWidth={1.8} />
            {pr?.additions !== undefined && pr.deletions !== undefined ? (
              <span className="argus-inspector-pr-lines" aria-label={`${formatLines(pr.additions)} lines added, ${formatLines(pr.deletions)} lines deleted`}>
                <span className="argus-inspector-pr-add">+{formatLines(pr.additions)}</span>
                <span className="argus-inspector-pr-del">−{formatLines(pr.deletions)}</span>
              </span>
            ) : 'Changed files'}
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
  const { prs, enabled, error, reload } = useSessionPrs(session.id, ctx.prStatusEnabled, refreshKey);
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
        {list.map((entry) => <PrRow key={entry.url} entry={entry} sessionId={session.id} ctx={ctx} onChanged={reload} />)}
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
