import type { GitBranchInfo, GitRefsResponse } from '@argus/shared';
import { Cloud, FolderGit2, GitBranch } from 'lucide-react';
import { EmptyState, ErrorState, Icon, LoadingState } from '../../../components/primitives/index.js';
import { commitAge, commitDateTime } from '../../../utils/gitFormat.js';
import { useNow } from '../../../hooks/useNow.js';

type Refs = NonNullable<GitRefsResponse['refs']>;

interface RefsState {
  refs: GitRefsResponse['refs'] | undefined;
  error: string | null;
  onRetry: () => void;
}

function RefsGate({ refs, error, onRetry, children }: RefsState & { children: (refs: Refs) => React.ReactNode }) {
  if (refs === undefined) return error ? <ErrorState title="Couldn’t read the branches" detail={error} onRetry={onRetry} /> : <LoadingState label="Reading branches" />;
  if (refs === null) return <EmptyState icon={GitBranch} title="Not a git repository" />;
  return <>{children(refs)}</>;
}

/** Tracking state of a local branch: "↑2 ↓1", "in sync", "gone", or nothing. */
function Tracking({ b }: { b: GitBranchInfo }) {
  if (b.upstreamGone) return <span className="argus-git-warn" title={`${b.upstream ?? 'The upstream'} was deleted on the remote`}>upstream gone</span>;
  if (!b.upstream) return <span className="argus-git-dim">no upstream</span>;
  return (
    <span title={`Tracks ${b.upstream}`}>
      <span className="argus-git-mono">{b.upstream}</span>
      {b.ahead === 0 && b.behind === 0 && <span className="argus-git-dim"> · in sync</span>}
      {!!b.ahead && <span className="argus-shell-git-ahead" title={`${b.ahead} to push`}> ↑{b.ahead}</span>}
      {!!b.behind && <span className="argus-shell-git-behind" title={`${b.behind} to pull`}> ↓{b.behind}</span>}
    </span>
  );
}

function BranchTable({ title, branches, local, onShowHistory }: {
  title: string;
  branches: GitBranchInfo[];
  local: boolean;
  onShowHistory: (b: GitBranchInfo) => void;
}) {
  const now = useNow();
  return (
    <section className="argus-git-table-section">
      <h3 className="eyebrow argus-git-table-title">{title} · {branches.length}</h3>
      {branches.length === 0 ? <div className="argus-git-dim argus-git-table-empty">None.</div> : (
        <div className="argus-git-table" data-local={local || undefined}>
          {branches.map((b) => (
            <button
              key={b.ref}
              type="button"
             
              className="argus-git-row"
              data-current={b.current || undefined}
              title={`Show the history of ${b.name}`}
              onClick={() => onShowHistory(b)}
            >
              <span className="argus-git-row-name">
                <Icon icon={local ? GitBranch : Cloud} size={12} strokeWidth={1.8} />
                <span className="argus-git-ellipsis">{b.name}</span>
                {b.current && <span className="argus-git-badge" data-tone="accent">current</span>}
                {b.worktreePath && <span className="argus-git-badge" title={b.worktreePath}>worktree</span>}
              </span>
              {local && <span className="argus-git-row-track"><Tracking b={b} /></span>}
              <span className="argus-git-mono argus-git-dim">{b.shortHash}</span>
              <span className="argus-git-ellipsis argus-git-row-subject">{b.subject}</span>
              <span className="argus-git-dim argus-git-row-age" title={commitDateTime(b.date)}>{commitAge(b.date, now)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Local and remote-tracking branches; picking one shows its history. */
export function BranchesView({ onShowHistory, ...state }: RefsState & { onShowHistory: (b: GitBranchInfo) => void }) {
  return (
    <RefsGate {...state}>
      {(refs) => (
        <div className="argus-git-tables argus-scroll">
          <BranchTable title="LOCAL" branches={refs.local} local onShowHistory={onShowHistory} />
          <BranchTable title="REMOTE" branches={refs.remote} local={false} onShowHistory={onShowHistory} />
        </div>
      )}
    </RefsGate>
  );
}

/** The repo's worktrees, the session's own marked. */
export function WorktreesView(state: RefsState) {
  return (
    <RefsGate {...state}>
      {(refs) => (
        <div className="argus-git-tables argus-scroll">
          <section className="argus-git-table-section">
            <h3 className="eyebrow argus-git-table-title">WORKTREES · {refs.worktrees.length}</h3>
            {refs.worktrees.length === 0 ? <div className="argus-git-dim argus-git-table-empty">None.</div> : (
              <div className="argus-git-table">
                {refs.worktrees.map((w) => (
                  <div key={w.path} className="argus-git-row argus-git-row-static" data-current={w.current || undefined}>
                    <span className="argus-git-row-name">
                      <Icon icon={FolderGit2} size={12} strokeWidth={1.8} />
                      {/* Folder name first: worktrees often share a long parent path. */}
                      <span className="argus-git-ellipsis argus-git-mono argus-git-select" title={w.path}>
                        {w.path.slice(w.path.lastIndexOf('/') + 1) || w.path}
                        <span className="argus-git-dim"> {w.path.slice(0, w.path.lastIndexOf('/') + 1)}</span>
                      </span>
                    </span>
                    <span className="argus-git-ellipsis">
                      {w.branch ?? <span className="argus-git-dim">{w.bare ? 'bare' : 'detached'}</span>}
                    </span>
                    <span className="argus-git-mono argus-git-dim">{w.head?.slice(0, 7) ?? ''}</span>
                    <span className="argus-git-badges">
                      {w.current && <span className="argus-git-badge" data-tone="accent">this session</span>}
                      {w.main && <span className="argus-git-badge">main</span>}
                      {w.locked && <span className="argus-git-badge">locked</span>}
                      {w.prunable && <span className="argus-git-badge" data-tone="warn">prunable</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </RefsGate>
  );
}
