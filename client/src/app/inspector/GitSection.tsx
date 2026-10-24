import { GitBranch } from 'lucide-react';
import type { GitSummaryFile } from '@argus/shared';
import { Icon } from '../../components/primitives/index.js';
import { useGitSummary } from '../../hooks/useGitSummary.js';
import type { InspectorSectionProps } from './types.js';
import { InspectorEmpty, InspectorRow } from './InspectorRow.js';

const STATUS_TITLE: Record<GitSummaryFile['status'], string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Conflicted',
  '?': 'Untracked',
};

function splitPath(p: string): { dir: string; base: string } {
  const i = p.lastIndexOf('/');
  return i < 0 ? { dir: '', base: p } : { dir: p.slice(0, i + 1), base: p.slice(i + 1) };
}

/** Branch, upstream, ahead/behind and the changed files of the session's work root. */
export function GitBody({ session, ctx }: InspectorSectionProps) {
  // Refetch at once when the server reports a git change, instead of on the next tick.
  const refreshKey = `${session.hasGitChanges}|${session.cwd}|${session.shellGit?.branch}|${session.shellGit?.changes}`;
  const { summary, error } = useGitSummary(session.id, true, refreshKey);

  if (summary === undefined) {
    return <InspectorEmpty>{error ? `Couldn’t read git status: ${error}` : 'Reading git status…'}</InspectorEmpty>;
  }
  if (summary === null) return <InspectorEmpty>Not a git repository.</InspectorEmpty>;

  const tracked = summary.ahead !== null;
  return (
    <>
      {error && <InspectorEmpty>Couldn’t refresh git status ({error}); showing the last reading.</InspectorEmpty>}
      <InspectorRow label="Branch" title={summary.root}>
        <span className="argus-inspector-branch">
          <Icon icon={GitBranch} size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
          <span className="argus-inspector-ellipsis">{summary.branch ?? 'empty'}</span>
          {summary.detached && <span className="argus-inspector-tag">detached</span>}
        </span>
      </InspectorRow>
      <InspectorRow label="Upstream">
        {tracked ? (
          <>
            <span className="argus-inspector-ellipsis">{summary.upstream}</span>
            {summary.ahead === 0 && summary.behind === 0 ? (
              <span className="argus-inspector-dim"> · in sync</span>
            ) : (
              <>
                {!!summary.ahead && <span className="argus-shell-git-ahead" title={`${summary.ahead} to push`}> ↑{summary.ahead}</span>}
                {!!summary.behind && <span className="argus-shell-git-behind" title={`${summary.behind} to pull`}> ↓{summary.behind}</span>}
              </>
            )}
          </>
        ) : (
          <span className="argus-inspector-dim">not pushed</span>
        )}
      </InspectorRow>
      <InspectorRow label="Changes">
        {summary.changes === 0 ? <span className="argus-inspector-dim">clean</span> : (
          <button type="button" className="argus-inspector-link" onClick={() => ctx.onOpenDiff(session.id)}>
            {summary.changes} {summary.changes === 1 ? 'file' : 'files'}
          </button>
        )}
      </InspectorRow>
      {summary.files.length > 0 && (
        <ul className="argus-inspector-files" aria-label="Changed files">
          {summary.files.map((f) => {
            const { dir, base } = splitPath(f.path);
            return (
              <li key={f.path}>
                <button
                  type="button"
                  className="argus-inspector-file"
                  title={`${STATUS_TITLE[f.status]}${f.staged ? ' · staged' : ''} — ${f.path}`}
                  onClick={() => ctx.onOpenDiff(session.id, f.path)}
                >
                  <span className="argus-inspector-file-status" data-status={f.status}>{f.status}</span>
                  <span className="argus-inspector-file-base">{base}</span>
                  {dir && <span className="argus-inspector-file-dir">{dir}</span>}
                </button>
              </li>
            );
          })}
          {summary.files.length < summary.changes && (
            <li className="argus-inspector-empty">and {summary.changes - summary.files.length} more — open the Diff</li>
          )}
        </ul>
      )}
    </>
  );
}

/** Collapsed-header glance from what the session already carries (no fetch). */
export function GitGlance({ session }: InspectorSectionProps) {
  const branch = session.shellGit?.branch ?? session.worktreeBranch?.replace(/^argus\//, '');
  const dirty = session.shellGit ? session.shellGit.changes > 0 : session.hasGitChanges;
  if (!branch && !dirty) return null;
  return (
    <>
      {branch && <span className="argus-inspector-ellipsis">{branch}</span>}
      {dirty && <span className="argus-shell-git-changes" aria-label="uncommitted changes"> ●</span>}
    </>
  );
}
