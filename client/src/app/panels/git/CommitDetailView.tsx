import type { GitCommitDetail } from '@argus/shared';
import { GitCommit } from 'lucide-react';
import { useGitCommitDetail } from '../../../hooks/useGitHistory.js';
import { commitDateTime } from '../../../utils/gitFormat.js';
import { EmptyState, ErrorState, LoadingState } from '../../../components/primitives/index.js';
import { ReadOnlyDiff } from '../ReadOnlyDiff.js';
import { RefChips } from './RefChips.js';

interface CommitDetailViewProps {
  sessionId: string;
  folderPath: string;
  hash: string | null;
  mode: 'split' | 'unified';
  /** Moves when the repo may have changed: refetches the commit (its refs). */
  refreshKey?: unknown;
  /** Select another commit (a parent link). */
  onSelectCommit: (hash: string) => void;
}

/** One commit: full message, metadata and its diff (read-only). */
export function CommitDetailView({ sessionId, folderPath, hash, mode, refreshKey, onSelectCommit }: CommitDetailViewProps) {
  const { detail, error, retry } = useGitCommitDetail(sessionId, hash, refreshKey);

  if (!hash) return <EmptyState icon={GitCommit} title="No commit selected" hint="Pick a commit on the left." />;
  if (error) return <ErrorState title="Couldn’t read the commit" detail={error} onRetry={retry} />;
  if (!detail) return <LoadingState label="Loading commit" />;

  return (
    <div className="argus-git-detail">
      <CommitHeader detail={detail} onSelectCommit={onSelectCommit} />
      <ReadOnlyDiff
        // A new commit is a new file list: reset scroll and collapse state.
        key={detail.hash}
        diff={detail.diff}
        sessionId={sessionId}
        folderPath={folderPath}
        mode={mode}
        notice={<DiffNotice detail={detail} />}
        empty={<div className="argus-rodiff-empty">{emptyLabel(detail)}</div>}
      />
    </div>
  );
}

function emptyLabel(d: GitCommitDetail): string {
  if (d.truncated) return 'This commit’s diff is too large to display.';
  if (d.files.length === 0) return d.parents.length > 1 ? 'This merge brings in no changes.' : 'This commit changes no files.';
  return 'Only binary changes or mode changes.';
}

function CommitHeader({ detail: d, onSelectCommit }: { detail: GitCommitDetail; onSelectCommit: (hash: string) => void }) {
  // The subject is git's %s — the whole first paragraph — so the body starts after it.
  const para = d.message.indexOf('\n\n');
  const body = para < 0 ? '' : d.message.slice(para).replace(/^\n+/, '');
  const sameCommitter = d.committerName === d.authorName && d.committerEmail === d.authorEmail;
  const adds = d.files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const dels = d.files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  return (
    <header className="argus-git-detail-head argus-scroll">
      <div className="argus-git-detail-subject">
        <span>{d.subject || '(no message)'}</span>
        <RefChips refs={d.refs} />
      </div>
      {body && <pre className="argus-git-detail-body">{body}</pre>}
      <dl className="argus-git-detail-meta">
        <dt>Commit</dt>
        <dd className="argus-git-mono argus-git-select">{d.hash}</dd>
        <dt>Author</dt>
        <dd>
          {d.authorName} <span className="argus-git-dim">&lt;{d.authorEmail}&gt;</span>
          <span className="argus-git-dim"> · {commitDateTime(d.authorDate)}</span>
        </dd>
        {(!sameCommitter || d.commitDate !== d.authorDate) && (
          <>
            <dt>Committer</dt>
            <dd>
              {d.committerName} <span className="argus-git-dim">&lt;{d.committerEmail}&gt;</span>
              <span className="argus-git-dim"> · {commitDateTime(d.commitDate)}</span>
            </dd>
          </>
        )}
        <dt>{d.parents.length > 1 ? 'Parents' : 'Parent'}</dt>
        <dd className="argus-git-mono">
          {d.parents.length === 0 ? <span className="argus-git-dim">none (root commit)</span> : d.parents.map((p, i) => (
            <span key={p}>
              {i > 0 && ' '}
              <button type="button" className="argus-git-link" title={p} onClick={() => onSelectCommit(p)}>{p.slice(0, d.shortHash.length)}</button>
            </span>
          ))}
          {d.parents.length > 1 && <span className="argus-git-dim"> · diff against the first parent</span>}
        </dd>
        <dt>Changes</dt>
        <dd>
          {d.files.length} {d.files.length === 1 ? 'file' : 'files'}
          <span className="argus-git-add"> +{adds}</span>
          <span className="argus-git-del"> −{dels}</span>
        </dd>
      </dl>
    </header>
  );
}

/** Above the file list: what the diff leaves out, so a short list isn't misread. */
function DiffNotice({ detail: d }: { detail: GitCommitDetail }) {
  if (d.truncated) {
    return (
      <div className="argus-git-notice" role="note">
        The diff is too large to show. Files changed:
        <ul className="argus-git-notice-files">
          {d.files.map((f) => (
            <li key={f.path} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
              <span className="argus-git-mono">{f.path}</span>
              {f.additions === null ? <span className="argus-git-dim"> binary</span> : (
                <>
                  <span className="argus-git-add"> +{f.additions}</span>
                  <span className="argus-git-del"> −{f.deletions}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (d.oversized?.length) {
    return (
      <div className="argus-git-notice" role="note" title={d.oversized.join('\n')}>
        {d.oversized.length === 1 ? '1 file is' : `${d.oversized.length} files are`} too large to preview — listed without content.
      </div>
    );
  }
  return null;
}
