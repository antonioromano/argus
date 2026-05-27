import { useMemo } from 'react';
import type { SessionInfo } from '@argus/shared';
import { GitBranch, GitCommit, Maximize2, RefreshCw, File } from 'lucide-react';
import parseDiff from 'parse-diff';
import { useGitDiff } from '../../hooks/useGitDiff.js';
import { Chip, IconButton, LoadingState, EmptyState, ErrorState, Button } from '../../components/primitives/index.js';

interface DiffSidePanelProps {
  session: SessionInfo;
  onExpand: () => void;
  onCommit?: () => void;
}

interface FileSummary {
  path: string;
  add: number;
  del: number;
  source: 'unstaged' | 'staged' | 'branch';
  isNew: boolean;
  isDeleted: boolean;
}

function summarize(rawDiff: string, source: 'unstaged' | 'staged' | 'branch'): FileSummary[] {
  if (!rawDiff || !rawDiff.trim()) return [];
  try {
    const files = parseDiff(rawDiff);
    return files.map((f) => ({
      path: f.to && f.to !== '/dev/null' ? f.to : f.from ?? '?',
      add: f.additions ?? 0,
      del: f.deletions ?? 0,
      source,
      isNew: f.new ?? false,
      isDeleted: f.deleted ?? false,
    }));
  } catch {
    return [];
  }
}

export function DiffSidePanel({ session, onExpand, onCommit }: DiffSidePanelProps) {
  const { diff, isLoading, error, refresh } = useGitDiff({
    sessionId: session.id,
    isOpen: true,
    sessionStatus: session.status,
  });

  const files = useMemo((): FileSummary[] => {
    if (!diff) return [];
    return [
      ...summarize(diff.unstaged, 'unstaged'),
      ...summarize(diff.staged, 'staged'),
      ...summarize(diff.branch, 'branch'),
    ];
  }, [diff]);

  const totalFiles = files.length + (diff?.untracked.length ?? 0);

  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        background: 'var(--bg-1)',
        borderLeft: '1px solid var(--line-2)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-3) var(--s-4)',
          borderBottom: '1px solid var(--line-2)',
        }}
      >
        <GitBranch size={13} strokeWidth={1.6} color="var(--dirty)" />
        <span className="eyebrow" style={{ color: 'var(--fg-0)' }}>Diff</span>
        <div style={{ flex: 1 }} />
        {totalFiles > 0 && <Chip dot="var(--dirty)">{totalFiles} files</Chip>}
        <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={refresh} />
        <IconButton icon={Maximize2} label="Expand" size="sm" onClick={onExpand} />
      </div>

      <div className="argus-scroll" style={{ flex: 1, overflow: 'auto', padding: 'var(--s-2) 0' }}>
        {isLoading && totalFiles === 0 && <LoadingState label="Loading diff" />}
        {error && !isLoading && (
          <ErrorState title="Diff failed" detail={error} onRetry={refresh} />
        )}
        {!isLoading && !error && totalFiles === 0 && (
          <EmptyState
            icon={GitCommit}
            title="No changes"
            hint="Working tree is clean."
          />
        )}
        {files.map((f) => (
          <button
            key={`${f.source}::${f.path}`}
            onClick={onExpand}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-2)',
              padding: '6px var(--s-4)',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <File size={12} strokeWidth={1.6} color="var(--fg-3)" />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-tiny)',
                color: 'var(--fg-1)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {f.path}
            </span>
            {f.isNew && <span className="eyebrow" style={{ color: 'var(--accent)' }}>NEW</span>}
            {f.isDeleted && <span className="eyebrow" style={{ color: 'var(--danger)' }}>DEL</span>}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--ok)' }}>+{f.add}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--danger)' }}>−{f.del}</span>
          </button>
        ))}
        {diff?.untracked.map((path) => (
          <div
            key={`u::${path}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-2)',
              padding: '6px var(--s-4)',
            }}
          >
            <File size={12} strokeWidth={1.6} color="var(--fg-3)" />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--t-tiny)',
                color: 'var(--fg-2)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {path}
            </span>
            <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>UNTRACKED</span>
          </div>
        ))}
      </div>

      {totalFiles > 0 && (
        <div style={{ padding: 'var(--s-3) var(--s-4)', borderTop: '1px solid var(--line-2)' }}>
          <Button variant="primary" full icon={GitCommit} onClick={onCommit ?? onExpand}>
            Commit · {totalFiles} file{totalFiles !== 1 ? 's' : ''}
          </Button>
        </div>
      )}
    </aside>
  );
}
