import { useRef, useState } from 'react';
import type { MouseEvent as RMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, ExternalLink, Eye, FileDiff, GitPullRequest, GitPullRequestArrow, GitPullRequestDraft, Link, MessageSquareWarning, MoreHorizontal, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PrReviewDecision, SessionPrEntry } from '@argus/shared';
import { AlertSheet, ContextMenu, Icon, IconButton, Tooltip, pushToast } from '../../components/primitives/index.js';
import type { ContextMenuEntry } from '../../components/primitives/index.js';
import { api } from '../../services/api.js';
import { openExternal } from '../../utils/openExternal.js';
import {
  PR_CI_LABEL, PR_REVIEW_LABEL, formatLines, PR_STATE_ICON, PR_STATE_LABEL, isLivePr, prNumberOf, prRef, prShortRef, prTone, summarizePrStates, worstCi,
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

/** Review decisions shown as an icon in the row's right column (none → nothing). */
const REVIEW_ICON: Record<Exclude<PrReviewDecision, 'none'>, LucideIcon> = {
  approved: CircleCheck,
  changes_requested: MessageSquareWarning,
  review_required: Eye,
};

/**
 * One PR, in at most three lines: the title (one line, opens it on GitHub);
 * `repo #n` and — when `ctx.onOpenPrDiff` is wired (B4) — its changes as
 * `+N −M` (C2; "Changed files" until gh reports the counts); then, only when
 * there is something to say, "this branch" and Mark ready for a draft (C3).
 * The state is the glyph's color (its tooltip names it); the review and
 * conflict icons sit under it. On the right: the `…` menu (C4: also on
 * right-click), with the checks dot that opens the CI monitoring popover (C1)
 * under it. Every cell is placed on the row's grid, so whatever sits under
 * the glyph or the `…` is centered on the second line.
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
  const shortRef = prShortRef(url, pr?.number);
  const live = !!pr && isLivePr(pr);
  const review = live && pr.review && pr.review !== 'none' ? pr.review : null;
  const conflicting = live && pr.mergeable === 'conflicting';
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const [confirmDraft, setConfirmDraft] = useState(false);

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
  // C4: the row's `…` menu (also on right-click).
  const copyLink = () => {
    navigator.clipboard.writeText(url).then(
      () => pushToast('Link copied', 'ok'),
      (err: unknown) => pushToast(err instanceof Error ? err.message : String(err), 'danger'),
    );
  };
  const menuItems: ContextMenuEntry[] = [
    { id: 'open', label: 'Open on GitHub', icon: ExternalLink, onClick: () => openExternal(url) },
    { id: 'copy', label: 'Copy link', icon: Link, onClick: copyLink },
    ...(ctx.onOpenPrDiff ? [{ id: 'changes', label: 'View changes', icon: FileDiff, onClick: () => ctx.onOpenPrDiff!(sessionId, entry) }] : []),
    ...(pr?.state === 'open' ? [
      { separator: true as const },
      { id: 'draft', label: 'Convert to draft', icon: GitPullRequestDraft, disabled: busy, onClick: () => setConfirmDraft(true) },
    ] : []),
  ];
  const openMenuAt = (e: RMouseEvent<HTMLElement>) => {
    // React bubbles events out of portals: a right-click inside this row's own
    // menu, CI popover or confirm sheet lands here too, but not in the row's DOM.
    if (!e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };
  // The `…` button toggles: ContextMenu leaves presses on its anchor to it.
  const toggleMenuUnder = (e: RMouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu((m) => (m ? null : { x: r.left, y: r.bottom + 4 }));
  };

  return (
    <li className="argus-inspector-prrow" data-state={pr?.state ?? 'unknown'} data-tone={pr ? prTone(pr) : undefined} onContextMenu={openMenuAt}>
      <span className="argus-inspector-pr-glyph" role="img" aria-label={pr ? `${PR_STATE_LABEL[pr.state]} pull request` : 'Pull request'} title={pr ? PR_STATE_LABEL[pr.state] : undefined}>
        <Icon icon={pr ? PR_STATE_ICON[pr.state] : GitPullRequest} size={14} strokeWidth={2} />
      </span>
      {/* Under the state glyph, one per line: the review icon (in line with
          the second line), then the conflict icon. */}
      {review && (
        <Tooltip content={PR_REVIEW_LABEL[review]}>
          <span className="argus-inspector-pr-flag argus-inspector-pr-review" data-review={review} role="img" aria-label={PR_REVIEW_LABEL[review]} tabIndex={0}>
            <Icon icon={REVIEW_ICON[review]} size={12} strokeWidth={1.8} />
          </span>
        </Tooltip>
      )}
      {conflicting && (
        <Tooltip content="merge conflicts">
          <span className="argus-inspector-pr-flag argus-inspector-pr-conflict" data-row={review ? 3 : 2} role="img" aria-label="merge conflicts" tabIndex={0}>
            <Icon icon={TriangleAlert} size={12} strokeWidth={1.8} />
          </span>
        </Tooltip>
      )}
      <button type="button" className="argus-inspector-pr" onClick={() => openExternal(url)} title={`${pr?.title ? `${pr.title}\n` : ''}Open ${ref} on GitHub`}>
        <span className="argus-inspector-pr-title">{pr?.title || shortRef}</span>
        <Icon icon={ExternalLink} size={11} strokeWidth={1.8} className="argus-inspector-pr-ext" />
      </button>
      {(pr?.title || ctx.onOpenPrDiff) && (
        <div className="argus-inspector-pr-line">
          {pr?.title && <span className="argus-inspector-pr-ref" title={ref}>{shortRef}</span>}
          {ctx.onOpenPrDiff && (
            <button type="button" className="argus-inspector-pr-files" title="Open changes" onClick={() => ctx.onOpenPrDiff!(sessionId, entry)}>
              {pr?.additions !== undefined && pr.deletions !== undefined ? (
                <span className="argus-inspector-pr-lines" aria-label={`${formatLines(pr.additions)} lines added, ${formatLines(pr.deletions)} lines deleted`}>
                  <span className="argus-inspector-pr-add">+{formatLines(pr.additions)}</span>
                  <span className="argus-inspector-pr-del">−{formatLines(pr.deletions)}</span>
                </span>
              ) : (
                <>
                  <Icon icon={FileDiff} size={12} strokeWidth={1.8} />
                  Changed files
                </>
              )}
            </button>
          )}
        </div>
      )}
      {(!pr || entry.folderBranch || pr.state === 'draft') && (
        <div className="argus-inspector-pr-meta">
          {!pr && <span>status unavailable</span>}
          {entry.folderBranch && (
            <span title={pr?.branch ? `PR of ${pr.branch}, the branch checked out in the session folder` : undefined}>this branch</span>
          )}
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
        </div>
      )}
      <span ref={moreRef} className="argus-inspector-pr-more" data-open={menu ? '' : undefined}>
        <IconButton icon={MoreHorizontal} label={`More actions for ${ref}`} size="sm" tooltip={false} onClick={toggleMenuUnder} />
      </span>
      {/* Under the `…`, in line with the second line: the checks dot. */}
      {live && <span className="argus-inspector-pr-ci-cell"><CiStatus pr={pr} /></span>}
      {/* Portalled: the inspector column scrolls and clips. */}
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} anchor={moreRef} />, document.body)}
      {confirmDraft && createPortal(
        <AlertSheet
          isOpen
          title="Convert to draft?"
          message={`${ref} goes back to draft. Reviewers aren’t asked for a review until it is marked ready again.`}
          confirmLabel="Convert to draft"
          onConfirm={() => { setConfirmDraft(false); void setReady(false); }}
          onCancel={() => setConfirmDraft(false)}
        />,
        document.body,
      )}
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
