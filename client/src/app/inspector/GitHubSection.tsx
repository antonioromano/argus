import { ExternalLink } from 'lucide-react';
import { Icon } from '../../components/primitives/index.js';
import { openExternal } from '../../utils/openExternal.js';
import { PR_CI_LABEL, PR_STATE_ICON, PR_STATE_LABEL, prRepo } from '../../utils/prFormat.js';
import type { InspectorSectionProps } from './types.js';
import { InspectorEmpty, InspectorRow } from './InspectorRow.js';

/**
 * The session's pull request. One PR today (the one its branch or its
 * conversation points at); the list of every PR of the session lands here next.
 */
export function GitHubBody({ session, ctx }: InspectorSectionProps) {
  if (!ctx.prStatusEnabled) return <InspectorEmpty>Pull request status is off (Settings → Shell header).</InspectorEmpty>;
  const pr = session.pr;
  if (!pr) return <InspectorEmpty>No pull request for this session.</InspectorEmpty>;

  const repo = prRepo(pr.url);
  const live = pr.state === 'open' || pr.state === 'draft';
  return (
    <>
      <button
        type="button"
        className="argus-inspector-pr"
        data-state={pr.state}
        onClick={() => openExternal(pr.url)}
        title="Open on GitHub"
      >
        <Icon icon={PR_STATE_ICON[pr.state]} size={13} strokeWidth={2} className="argus-pr-icon" style={{ flexShrink: 0 }} />
        <span className="argus-inspector-ellipsis">{repo ? `${repo}#${pr.number}` : `#${pr.number}`}</span>
        <Icon icon={ExternalLink} size={11} strokeWidth={1.8} style={{ flexShrink: 0, marginLeft: 'auto' }} />
      </button>
      <InspectorRow label="State">{PR_STATE_LABEL[pr.state]}</InspectorRow>
      <InspectorRow label="Branch"><span className="argus-inspector-ellipsis">{pr.branch}</span></InspectorRow>
      {live && (
        <InspectorRow label="Checks">
          <span className="argus-inspector-ci">
            {pr.ci !== 'none' && <span className="argus-pr-ci" data-ci={pr.ci} aria-hidden />}
            {PR_CI_LABEL[pr.ci]}
          </span>
        </InspectorRow>
      )}
    </>
  );
}

/** Collapsed-header glance: the PR number and its checks. */
export function GitHubGlance({ session, ctx }: InspectorSectionProps) {
  const pr = session.pr;
  if (!ctx.prStatusEnabled || !pr) return null;
  return (
    <span className="argus-inspector-ci" data-state={pr.state}>
      #{pr.number}
      {(pr.state === 'open' || pr.state === 'draft') && pr.ci !== 'none' && <span className="argus-pr-ci" data-ci={pr.ci} aria-hidden />}
    </span>
  );
}
