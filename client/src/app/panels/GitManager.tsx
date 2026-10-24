import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { GitBranchInfo, GitCommitSummary, SessionInfo } from '@argus/shared';
import { AlignLeft, GitBranch, GitCommit, GitMerge, History, RefreshCw, SplitSquareHorizontal, X } from 'lucide-react';
import { useGitHistory, useGitRefs } from '../../hooks/useGitHistory.js';
import { useNow } from '../../hooks/useNow.js';
import { workRoot } from '../../utils/workRoot.js';
import { commitAge, commitDateTime } from '../../utils/gitFormat.js';
import { EmptyState, ErrorState, Icon, IconButton, LoadingState } from '../../components/primitives/index.js';
import type { GitManagerTab } from '../types.js';
import { CommitDetailView } from './git/CommitDetailView.js';
import { RefChips } from './git/RefChips.js';
import { BranchesView, WorktreesView } from './git/RefsViews.js';

interface GitManagerProps {
  session: SessionInfo;
  /** Close the tool window (return to the shell). */
  onClose: () => void;
  /** Select this commit (hash) when opened — and whenever it changes while open. */
  initialCommit?: string;
  initialTab?: GitManagerTab;
}

const TABS: { id: GitManagerTab; label: string }[] = [
  { id: 'history', label: 'History' },
  { id: 'branches', label: 'Branches' },
  { id: 'worktrees', label: 'Worktrees' },
];

/**
 * Git Manager, read-only: the session repo's history with each commit's
 * message and diff, its branches (local and remote, with tracking) and its
 * worktrees. Opens full-view over the shell like the Diff and Files tool
 * windows. Nothing here writes to the repository.
 */
export function GitManager({ session, onClose, initialCommit, initialTab }: GitManagerProps) {
  const [tab, setTab] = useState<GitManagerTab>(initialTab ?? 'history');
  // The history starts from HEAD unless a branch was picked in the Branches tab.
  const [from, setFrom] = useState<{ ref: string; name: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(initialCommit ?? null);
  const [mode, setMode] = useState<'split' | 'unified'>('split');
  // Bumped by the Refresh button, so the open commit's refs are re-read too.
  const [manualRefresh, setManualRefresh] = useState(0);

  // Re-entering with a new target (another commit clicked in the Inspector)
  // reuses this instance: follow it.
  const [target, setTarget] = useState({ initialCommit, initialTab });
  if (target.initialCommit !== initialCommit || target.initialTab !== initialTab) {
    setTarget({ initialCommit, initialTab });
    if (initialCommit) {
      setSelected(initialCommit);
      setFrom(null);
    }
    setTab(initialTab ?? 'history');
  }

  // Moves with commits, checkouts and branch switches the session makes.
  const refreshKey = `${session.hasGitChanges}|${session.shellGit?.branch}|${session.shellGit?.changes}|${session.worktreeBranch}`;
  const history = useGitHistory(session.id, { ref: from?.ref, refreshKey });
  const refsState = useGitRefs(session.id, refreshKey);
  const refreshAll = () => {
    history.refresh();
    refsState.refresh();
    setManualRefresh((n) => n + 1);
  };

  // With nothing chosen, show the newest commit.
  const shown = selected ?? history.commits?.[0]?.hash ?? null;

  const showBranchHistory = useCallback((b: GitBranchInfo) => {
    setFrom(b.current ? null : { ref: b.ref, name: b.name });
    setSelected(null);
    setTab('history');
  }, []);

  const counts: Partial<Record<GitManagerTab, number>> = refsState.refs
    ? { branches: refsState.refs.local.length + refsState.refs.remote.length, worktrees: refsState.refs.worktrees.length }
    : {};

  return (
    <div className="argus-git">
      <div className="argus-git-head">
        <Icon icon={History} size={14} strokeWidth={1.6} color="var(--accent)" />
        <div className="eyebrow" style={{ color: 'var(--accent)' }}>ARGUS · GIT</div>
        <span className="argus-git-head-session">{session.name}</span>
        <div className="argus-git-tabs" role="tablist" aria-label="Git Manager views">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className="argus-git-tab"
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {counts[t.id] !== undefined && <span className="argus-git-tab-count">{counts[t.id]}</span>}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span className="argus-git-readonly" title="This view never changes the repository">read-only</span>
        {tab === 'history' && (
          <div className="argus-git-mode" role="group" aria-label="Diff layout">
            <button type="button" aria-pressed={mode === 'split'} onClick={() => setMode('split')}>
              <Icon icon={SplitSquareHorizontal} size={11} strokeWidth={1.6} /> SPLIT
            </button>
            <button type="button" aria-pressed={mode === 'unified'} onClick={() => setMode('unified')}>
              <Icon icon={AlignLeft} size={11} strokeWidth={1.6} /> UNIFIED
            </button>
          </div>
        )}
        <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={refreshAll} />
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
      </div>

      {tab === 'history' && (
        <div className="argus-git-body">
          <CommitList
            history={history}
            from={from}
            onClearFrom={() => { setFrom(null); setSelected(null); }}
            selected={shown}
            onSelect={setSelected}
          />
          <div className="argus-git-detail-pane">
            <CommitDetailView
              sessionId={session.id}
              folderPath={workRoot(session)}
              hash={shown}
              mode={mode}
              refreshKey={`${refreshKey}|${manualRefresh}`}
              onSelectCommit={setSelected}
            />
          </div>
        </div>
      )}
      {tab === 'branches' && (
        <BranchesView refs={refsState.refs} error={refsState.error} onRetry={refsState.refresh} onShowHistory={showBranchHistory} />
      )}
      {tab === 'worktrees' && (
        <WorktreesView refs={refsState.refs} error={refsState.error} onRetry={refsState.refresh} />
      )}
    </div>
  );
}

function CommitList({ history, from, onClearFrom, selected, onSelect }: {
  history: ReturnType<typeof useGitHistory>;
  from: { ref: string; name: string } | null;
  onClearFrom: () => void;
  selected: string | null;
  onSelect: (hash: string) => void;
}) {
  const { commits, hasMore, loading, error, loadMoreError, loadMore, refresh } = history;
  const now = useNow();
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Load the next page as the end of the list scrolls into view.
  useEffect(() => {
    const root = listRef.current;
    const el = sentinelRef.current;
    // After a failed page, wait for the retry button instead of hammering the server.
    if (!root || !el || !hasMore || loadMoreError) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { root, rootMargin: '200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore, loadMoreError]);

  // Bring the selected row into view when the selection changes (keyboard
  // stepping, a commit opened from the Inspector) — once per selection, so a
  // page appended while scrolling doesn't pull the list back to it. A commit
  // not loaded yet is scrolled to once its page arrives.
  const scrolledToRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || scrolledToRef.current === selected) return;
    const row = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row) return;
    scrolledToRef.current = selected;
    row.scrollIntoView({ block: 'nearest' });
  }, [selected, commits]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!commits?.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const i = commits.findIndex((c) => c.hash === selected);
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, commits.length - 1) : Math.max(i - 1, 0);
    onSelect(commits[next].hash);
    if (e.key === 'ArrowDown' && next >= commits.length - 5) loadMore();
  };

  let content: React.ReactNode;
  if (commits === undefined) {
    content = error ? <ErrorState title="Couldn’t read the history" detail={error} onRetry={refresh} /> : <LoadingState label="Reading history" />;
  } else if (commits === null) {
    content = <EmptyState icon={GitBranch} title="Not a git repository" />;
  } else if (commits.length === 0) {
    content = <EmptyState icon={GitCommit} title="No commits yet" />;
  } else {
    content = (
      <>
        {commits.map((c) => (
          <CommitRow key={c.hash} c={c} now={now} selected={c.hash === selected} onSelect={onSelect} />
        ))}
        <div ref={sentinelRef} className="argus-git-list-end">
          {error ? (
            <button type="button" className="argus-git-link" title={error} onClick={refresh}>Couldn’t refresh the history — retry</button>
          ) : loadMoreError ? (
            <button type="button" className="argus-git-link" title={loadMoreError} onClick={loadMore}>Couldn’t load more — retry</button>
          ) : hasMore ? (
            loading ? 'Loading…' : <button type="button" className="argus-git-link" onClick={loadMore}>Load more</button>
          ) : `${commits.length} ${commits.length === 1 ? 'commit' : 'commits'}`}
        </div>
      </>
    );
  }

  return (
    <div className="argus-git-list-pane">
      {from && (
        <div className="argus-git-from">
          <Icon icon={GitBranch} size={11} strokeWidth={2} />
          <span className="argus-git-ellipsis">History of <span className="argus-git-mono">{from.name}</span></span>
          <IconButton icon={X} label="Back to the current branch" size="sm" onClick={onClearFrom} />
        </div>
      )}
      <div
        ref={listRef}
        className="argus-git-list argus-scroll"
        role="listbox"
        aria-label="Commits"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {content}
      </div>
    </div>
  );
}

function CommitRow({ c, now, selected, onSelect }: { c: GitCommitSummary; now: number; selected: boolean; onSelect: (hash: string) => void }) {
  return (
    <div
      role="option"
      aria-selected={selected}
      className="argus-git-commit"
      onClick={() => onSelect(c.hash)}
      title={`${c.subject}\n${c.shortHash} · ${c.authorName} · ${commitDateTime(c.authorDate)}`}
    >
      <div className="argus-git-commit-line">
        {c.parents.length > 1 && <Icon icon={GitMerge} size={11} strokeWidth={2} className="argus-git-commit-merge" />}
        <span className="argus-git-commit-subject">{c.subject || '(no message)'}</span>
      </div>
      <div className="argus-git-commit-line argus-git-commit-meta">
        <span className="argus-git-mono">{c.shortHash}</span>
        <span className="argus-git-ellipsis">{c.authorName}</span>
        <span className="argus-git-commit-age">{commitAge(c.authorDate, now)}</span>
      </div>
      {c.refs.length > 0 && <RefChips refs={c.refs} max={4} />}
    </div>
  );
}
