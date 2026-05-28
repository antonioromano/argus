import { useMemo, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import parseDiff from 'parse-diff';
import { X, GitBranch, RefreshCw, GitCommit, AlignLeft, SplitSquareHorizontal } from 'lucide-react';
import { useGitDiff } from '../../hooks/useGitDiff.js';
import { SplitDiff } from './SplitDiff.js';
import {
  IconButton,
  Button,
  Chip,
  LoadingState,
  EmptyState,
  ErrorState,
} from '../../components/primitives/index.js';

interface DiffOverlayProps {
  session: SessionInfo;
  onClose: () => void;
  initialFile?: string;
}

type Source = 'unstaged' | 'staged' | 'branch';

interface FileSummary {
  path: string;
  add: number;
  del: number;
  source: Source;
  isNew: boolean;
  isDeleted: boolean;
  raw: string;
}

function summarize(rawDiff: string, source: Source): FileSummary[] {
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
      raw: rawDiff,
    }));
  } catch {
    return [];
  }
}

export function DiffOverlay({ session, onClose, initialFile }: DiffOverlayProps) {
  const { diff, isLoading, error, refresh } = useGitDiff({
    sessionId: session.id,
    isOpen: true,
    sessionStatus: session.status,
  });
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [selectedFile, setSelectedFile] = useState<string | null>(initialFile ?? null);

  const files = useMemo((): FileSummary[] => {
    if (!diff) return [];
    return [
      ...summarize(diff.unstaged, 'unstaged'),
      ...summarize(diff.staged, 'staged'),
      ...summarize(diff.branch, 'branch'),
    ];
  }, [diff]);

  const total = files.length + (diff?.untracked.length ?? 0);

  const effectiveSelected: string | null = useMemo(() => {
    if (selectedFile && files.some((f) => `${f.source}::${f.path}` === selectedFile)) {
      return selectedFile;
    }
    if (files.length > 0) return `${files[0].source}::${files[0].path}`;
    return null;
  }, [files, selectedFile]);

  return (
    <div
      style={{
        width: '92vw',
        height: '88vh',
        maxWidth: 1400,
        background: 'var(--bg-0)',
        border: '1px solid var(--line-3)',
        borderRadius: 'var(--r-4)',
        boxShadow: 'var(--shadow-sheet)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-3) var(--s-4)',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <GitBranch size={14} strokeWidth={1.6} color="var(--dirty)" />
        <div className="eyebrow" style={{ color: 'var(--accent)' }}>ARGUS · DIFF</div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', color: 'var(--fg-1)' }}>
          {session.name}
        </span>
        {total > 0 && <Chip dot="var(--dirty)">{total} files</Chip>}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'inline-flex', borderRadius: 'var(--r-2)', overflow: 'hidden', border: '1px solid var(--line-2)' }}>
          <button
            onClick={() => setViewMode('split')}
            style={modeBtn(viewMode === 'split')}
          >
            <SplitSquareHorizontal size={11} strokeWidth={1.6} /> SPLIT
          </button>
          <button
            onClick={() => setViewMode('unified')}
            style={modeBtn(viewMode === 'unified')}
          >
            <AlignLeft size={11} strokeWidth={1.6} /> UNIFIED
          </button>
        </div>
        <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={refresh} />
        <Button variant="primary" icon={GitCommit} size="sm">Commit</Button>
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <aside
          className="argus-scroll"
          style={{
            width: 280,
            flexShrink: 0,
            background: 'var(--bg-1)',
            borderRight: '1px solid var(--line-2)',
            overflowY: 'auto',
          }}
        >
          {isLoading && total === 0 && <LoadingState label="Loading diff" />}
          {error && <ErrorState title="Diff failed" detail={error} onRetry={refresh} />}
          {!isLoading && !error && total === 0 && (
            <EmptyState icon={GitCommit} title="No changes" hint="Working tree clean." />
          )}
          {(['unstaged', 'staged', 'branch'] as const).map((src) => {
            const grp = files.filter((f) => f.source === src);
            if (grp.length === 0) return null;
            return (
              <div key={src}>
                <div className="eyebrow" style={{ padding: 'var(--s-3) var(--s-4) var(--s-1)', color: 'var(--fg-3)' }}>
                  {src.toUpperCase()} · {grp.length}
                </div>
                {grp.map((f) => {
                  const id = `${f.source}::${f.path}`;
                  const sel = effectiveSelected === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setSelectedFile(id)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--s-2)',
                        padding: '6px var(--s-4)',
                        width: '100%',
                        boxSizing: 'border-box',
                        background: sel ? 'var(--bg-3)' : 'transparent',
                        borderLeft: `2px solid ${sel ? 'var(--accent)' : 'transparent'}`,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--t-tiny)',
                          color: sel ? 'var(--accent)' : 'var(--fg-1)',
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
                  );
                })}
              </div>
            );
          })}
        </aside>

        <main style={{ flex: 1, minWidth: 0, background: 'var(--bg-0)', overflow: 'auto' }} className="argus-scroll">
          {(() => {
            const selected = effectiveSelected
              ? files.find((f) => `${f.source}::${f.path}` === effectiveSelected)
              : undefined;
            return selected ? (
              <DiffViewer file={selected} mode={viewMode} />
            ) : (
              <div style={{ padding: 'var(--s-7)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
                {isLoading ? 'Loading diff…' : 'No files to view.'}
              </div>
            );
          })()}
        </main>
      </div>
    </div>
  );
}

const modeBtn = (active: boolean): React.CSSProperties => ({
  all: 'unset',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px var(--s-2)',
  background: active ? 'var(--bg-3)' : 'var(--bg-2)',
  color: active ? 'var(--accent)' : 'var(--fg-2)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-tiny)',
  letterSpacing: 'var(--tracking-eye)',
});

function lineText(c: { content: string }): string {
  return c.content.replace(/^[+\- ]/, '');
}

function DiffViewer({ file, mode }: { file: FileSummary; mode: 'split' | 'unified' }) {
  const files = useMemo(() => parseDiff(file.raw), [file.raw]);
  const target = files.find((f) => (f.to ?? f.from) === file.path);
  if (!target) return null;
  return (
    <div style={{ padding: 'var(--s-4)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
      <div
        className="eyebrow"
        style={{ color: 'var(--accent)', marginBottom: 'var(--s-3)' }}
      >
        {file.path} · {mode.toUpperCase()}
      </div>
      {mode === 'split' ? (
        <SplitDiff target={target} />
      ) : (
        target.chunks.map((chunk, i) => (
          <div key={i} style={{ marginBottom: 'var(--s-4)' }}>
            <div style={{ color: 'var(--fg-3)', padding: '2px var(--s-2)', background: 'var(--bg-1)', borderRadius: 'var(--r-1)', marginBottom: 4 }}>
              {chunk.content}
            </div>
            {chunk.changes.map((c, j) => {
              const isAdd = c.type === 'add';
              const isDel = c.type === 'del';
              return (
                <div
                  key={j}
                  style={{
                    display: 'flex',
                    gap: 'var(--s-2)',
                    padding: '0 var(--s-2)',
                    background: isAdd ? 'var(--diff-add)' : isDel ? 'var(--diff-del)' : 'transparent',
                    color: isAdd ? 'var(--diff-add-fg)' : isDel ? 'var(--diff-del-fg)' : 'var(--fg-1)',
                    whiteSpace: 'pre',
                  }}
                >
                  <span style={{ width: 14, color: 'var(--fg-4)', flexShrink: 0 }}>
                    {isAdd ? '+' : isDel ? '−' : ' '}
                  </span>
                  <span>{lineText(c)}</span>
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
