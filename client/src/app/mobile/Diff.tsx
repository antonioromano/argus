import { useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { useGitDiff } from '../../hooks/useGitDiff.js';
import { EmptyState, LoadingState, ErrorState } from '../../components/primitives/index.js';
import { GitBranch, ChevronLeft, ChevronRight } from 'lucide-react';
import parseDiff from 'parse-diff';

interface DiffProps {
  session: SessionInfo;
  onBack: () => void;
}

type ParsedFile = parseDiff.File & { src: 'unstaged' | 'staged' | 'branch' };

/** Per-session changes screen, pushed from the focused shell. No session
 *  picker — it's already this shell. Tap a file to expand its hunks. */
export function Diff({ session, onBack }: DiffProps) {
  const { diff, isLoading, error, refresh } = useGitDiff({
    sessionId: session.id,
    isOpen: true,
    sessionStatus: session.status,
  });
  const [open, setOpen] = useState<number | null>(0);

  const files: ParsedFile[] = diff
    ? [
        ...parseDiff(diff.unstaged ?? '').map((f) => ({ ...f, src: 'unstaged' as const })),
        ...parseDiff(diff.staged ?? '').map((f) => ({ ...f, src: 'staged' as const })),
        ...parseDiff(diff.branch ?? '').map((f) => ({ ...f, src: 'branch' as const })),
      ]
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg-0)' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s-2)',
          padding: '0 var(--s-3)', paddingTop: 'env(safe-area-inset-top, 0px)', minHeight: 52,
          background: 'var(--bg-1)', borderBottom: '1px solid var(--line-2)', flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          aria-label="Back"
          className="eyebrow"
          style={{ background: 'transparent', border: '1px solid var(--line-2)', cursor: 'pointer', color: 'var(--accent)', borderRadius: 'var(--r-2)', padding: '0 12px', minHeight: 44, display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--t-tiny)' }}
        >
          <ChevronLeft size={14} strokeWidth={1.6} /> BACK
        </button>
        <span className="eyebrow" style={{ flex: 1, fontSize: 'var(--t-sm)', color: 'var(--fg-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {session.name} — changes
        </span>
        {files.length > 0 && <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>{files.length} {files.length === 1 ? 'file' : 'files'}</span>}
      </div>

      <div className="argus-scroll" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        {isLoading && files.length === 0 && <LoadingState label="Loading changes" />}
        {error && <ErrorState title="Diff failed" detail={error} onRetry={refresh} />}
        {!isLoading && !error && files.length === 0 && (
          <EmptyState icon={GitBranch} title="No changes" hint="Working tree clean." />
        )}
        {files.map((f, i) => (
          <FileRow key={`${f.src}-${f.to ?? f.from}-${i}`} file={f} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
        ))}
      </div>
    </div>
  );
}

function FileRow({ file, open, onToggle }: { file: ParsedFile; open: boolean; onToggle: () => void }) {
  return (
    <div style={{ borderBottom: '1px solid var(--line-1)' }}>
      <button
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', width: '100%', padding: 'var(--s-3) var(--s-4)', background: open ? 'var(--bg-2)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <ChevronRight size={12} strokeWidth={2} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease', color: 'var(--fg-3)', flexShrink: 0 }} />
        <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.to ?? file.from}
        </span>
        <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>{file.src}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', color: 'var(--ok)' }}>+{file.additions}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', color: 'var(--danger)' }}>−{file.deletions}</span>
      </button>
      {open && (
        <div style={{ background: 'var(--bg-inset)', overflowX: 'auto' }}>
          {file.chunks.map((chunk, ci) => (
            <div key={ci}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--syn-fn)', padding: '4px var(--s-3)', background: 'rgba(125,211,252,.06)' }}>
                {chunk.content}
              </div>
              {chunk.changes.map((change, li) => {
                const isAdd = change.type === 'add';
                const isDel = change.type === 'del';
                return (
                  <div
                    key={li}
                    style={{
                      fontFamily: 'var(--font-mono)', fontSize: '10.5px', lineHeight: 1.6, whiteSpace: 'pre',
                      padding: '0 var(--s-3)',
                      background: isAdd ? 'var(--diff-add)' : isDel ? 'var(--diff-del)' : 'transparent',
                      color: isAdd ? 'var(--diff-add-fg)' : isDel ? 'var(--diff-del-fg)' : 'var(--fg-2)',
                    }}
                  >
                    {change.content}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
