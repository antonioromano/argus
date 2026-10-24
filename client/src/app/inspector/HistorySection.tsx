import { GitMerge } from 'lucide-react';
import { Icon } from '../../components/primitives/index.js';
import { useGitHistory } from '../../hooks/useGitHistory.js';
import { useNow } from '../../hooks/useNow.js';
import { commitAge, commitDateTime } from '../../utils/gitFormat.js';
import { RefChips } from '../panels/git/RefChips.js';
import type { InspectorSectionProps } from './types.js';
import { InspectorEmpty } from './InspectorRow.js';

/** Commits the card lists; the Git Manager has the rest. */
export const HISTORY_CARD_COMMITS = 8;

/**
 * The latest commits of the session's repo. A commit opens the Git Manager on
 * it (message + diff); the links below open its full history and branches.
 */
export function HistoryBody({ session, ctx }: InspectorSectionProps) {
  const refreshKey = `${session.hasGitChanges}|${session.cwd}|${session.shellGit?.branch}|${session.shellGit?.changes}`;
  const { commits, hasMore, error } = useGitHistory(session.id, { pageSize: HISTORY_CARD_COMMITS, refreshKey });
  const now = useNow();
  const open = ctx.onOpenGit;

  if (commits === undefined) {
    return <InspectorEmpty>{error ? `Couldn’t read the history: ${error}` : 'Reading history…'}</InspectorEmpty>;
  }
  if (commits === null) return <InspectorEmpty>Not a git repository.</InspectorEmpty>;
  if (commits.length === 0) return <InspectorEmpty>No commits yet.</InspectorEmpty>;

  return (
    <>
      <ul className="argus-inspector-commits" aria-label="Recent commits">
        {commits.map((c) => (
          <li key={c.hash}>
            <button
              type="button"
              className="argus-inspector-commit"
              disabled={!open}
              title={`${c.subject}\n${c.shortHash} · ${c.authorName} · ${commitDateTime(c.authorDate)}`}
              onClick={() => open?.(session.id, { commit: c.hash })}
            >
              <span className="argus-inspector-commit-subject">
                {c.parents.length > 1 && <Icon icon={GitMerge} size={10} strokeWidth={2} className="argus-inspector-commit-merge" />}
                {c.subject || '(no message)'}
              </span>
              <span className="argus-inspector-commit-meta">
                <span className="argus-inspector-commit-hash">{c.shortHash}</span>
                <span>{commitAge(c.authorDate, now)}</span>
                {c.refs.length > 0 && <RefChips refs={c.refs} max={2} />}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <div className="argus-inspector-links">
          <button type="button" className="argus-inspector-link" onClick={() => open(session.id)}>
            {hasMore ? 'All history' : 'Open history'}
          </button>
          <button type="button" className="argus-inspector-link" onClick={() => open(session.id, { tab: 'branches' })}>Branches</button>
          <button type="button" className="argus-inspector-link" onClick={() => open(session.id, { tab: 'worktrees' })}>Worktrees</button>
        </div>
      )}
    </>
  );
}
