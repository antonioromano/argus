import { useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { useGitDiff } from '../../hooks/useGitDiff.js';
import { EmptyState, LoadingState, ErrorState } from '../../components/primitives/index.js';
import { GitBranch } from 'lucide-react';
import parseDiff from 'parse-diff';

interface DiffProps {
  sessions: SessionInfo[];
}

export function Diff({ sessions }: DiffProps) {
  const [sessionId, setSessionId] = useState<string | null>(sessions[0]?.id ?? null);
  const session = sessions.find((s) => s.id === sessionId) ?? null;

  const { diff, isLoading, error, refresh } = useGitDiff({
    sessionId: session?.id ?? '',
    isOpen: !!session,
    sessionStatus: session?.status ?? 'idle',
  });

  if (sessions.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg-0)' }}>
        <Header />
        <EmptyState icon={GitBranch} title="No sessions" hint="Create a session on your Mac." />
      </div>
    );
  }

  const allFiles = diff
    ? [
        ...parseDiff(diff.unstaged ?? '').map((f) => ({ ...f, src: 'unstaged' as const })),
        ...parseDiff(diff.staged ?? '').map((f) => ({ ...f, src: 'staged' as const })),
        ...parseDiff(diff.branch ?? '').map((f) => ({ ...f, src: 'branch' as const })),
      ]
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg-0)' }}>
      <Header />
      <div style={{ padding: 'var(--s-3) var(--s-4)', background: 'var(--bg-1)', borderBottom: '1px solid var(--line-2)' }}>
        <select
          value={sessionId ?? ''}
          onChange={(e) => setSessionId(e.target.value)}
          style={{
            width: '100%',
            padding: '8px var(--s-3)',
            background: 'var(--bg-2)',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-2)',
            color: 'var(--fg-0)',
            fontFamily: 'var(--font-mono)',
            fontSize: 16,
          }}
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {s.folderPath.split('/').pop()}</option>
          ))}
        </select>
      </div>
      <div
        className="argus-scroll"
        style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}
      >
        {isLoading && allFiles.length === 0 && <LoadingState label="Loading diff" />}
        {error && <ErrorState title="Diff failed" detail={error} onRetry={refresh} />}
        {!isLoading && !error && allFiles.length === 0 && (
          <EmptyState icon={GitBranch} title="No changes" hint="Working tree clean." />
        )}
        {allFiles.map((f, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-2)',
              padding: 'var(--s-3) var(--s-4)',
              borderBottom: '1px solid var(--line-1)',
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', color: 'var(--fg-1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(f as parseDiff.File).to ?? (f as parseDiff.File).from}
            </span>
            <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>{f.src}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', color: 'var(--ok)' }}>+{f.additions}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', color: 'var(--danger)' }}>−{f.deletions}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--s-4)',
        height: 52,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: 'var(--bg-1)',
        borderBottom: '1px solid var(--line-2)',
        flexShrink: 0,
      }}
    >
      <span className="eyebrow" style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>DIFF</span>
    </div>
  );
}
