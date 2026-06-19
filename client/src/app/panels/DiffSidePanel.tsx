import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { GitBranch, GitCommit, Maximize2, RefreshCw, File } from 'lucide-react';
import parseDiff from 'parse-diff';
import { useGitDiff } from '../../hooks/useGitDiff.js';
import { Chip, IconButton, LoadingState, EmptyState, ErrorState, Button } from '../../components/primitives/index.js';
import { DiffViewer, UntrackedPlaceholder, type FileSummary } from '../overlays/DiffOverlay.js';

interface DiffSidePanelProps {
  session: SessionInfo;
  onExpand: (file?: string) => void;
  onCommit?: () => void;
  width?: number;
}

type ItemSource = 'unstaged' | 'staged' | 'branch' | 'untracked';

// Structurally a FileSummary (carries `raw` for DiffViewer) plus an id for selection.
interface Item extends FileSummary {
  id: string;
  source: ItemSource;
}

function summarize(rawDiff: string, source: 'unstaged' | 'staged' | 'branch'): Item[] {
  if (!rawDiff || !rawDiff.trim()) return [];
  try {
    const files = parseDiff(rawDiff);
    return files.map((f) => {
      const path = f.to && f.to !== '/dev/null' ? f.to : f.from ?? '?';
      return {
        id: `${source}::${path}`,
        path,
        add: f.additions ?? 0,
        del: f.deletions ?? 0,
        source,
        isNew: f.new ?? false,
        isDeleted: f.deleted ?? false,
        raw: rawDiff,
      };
    });
  } catch {
    return [];
  }
}

export function DiffSidePanel({ session, onExpand, onCommit, width = 320 }: DiffSidePanelProps) {
  const { diff, isLoading, error, refresh } = useGitDiff({
    sessionId: session.id,
    isOpen: true,
    sessionStatus: session.status,
  });

  // One flat, ordered, keyboard-navigable list: tracked files (deduped by path)
  // followed by untracked entries (selectable, no diff body).
  const items = useMemo((): Item[] => {
    if (!diff) return [];
    const seen = new Set<string>();
    const tracked = [
      ...summarize(diff.unstaged, 'unstaged'),
      ...summarize(diff.staged, 'staged'),
      ...summarize(diff.branch, 'branch'),
    ].filter((f) => (seen.has(f.path) ? false : (seen.add(f.path), true)));
    const untracked: Item[] = (diff.untracked ?? []).map((p) => ({
      id: `untracked::${p}`,
      path: p,
      add: 0,
      del: 0,
      source: 'untracked',
      isNew: true,
      isDeleted: false,
      raw: '',
    }));
    return [...tracked, ...untracked];
  }, [diff]);

  const totalFiles = items.length;
  const notAGitRepo = !!error && /not a git repository/i.test(error);

  const [selected, setSelected] = useState<string | null>(null);
  // Fall back to the first item when nothing is chosen or a refresh removed the
  // selected file (mirrors DiffOverlay's effectiveSelected).
  const effectiveSelected = useMemo(() => {
    if (selected && items.some((i) => i.id === selected)) return selected;
    return items[0]?.id ?? null;
  }, [items, selected]);
  const selectedItem = useMemo(
    () => items.find((i) => i.id === effectiveSelected) ?? null,
    [items, effectiveSelected],
  );
  const selectedRowRef = useRef<HTMLButtonElement>(null);

  // Up/Down move the selection (and the inline preview). preventDefault stops the
  // native list-scroll that would otherwise happen with a focused row button.
  // Editable focus (terminal textarea, inputs) keeps the arrows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const t = document.activeElement as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (items.length === 0) return;
      const ids = items.map((i) => i.id);
      const cur = effectiveSelected ? ids.indexOf(effectiveSelected) : -1;
      const start = cur >= 0 ? cur : 0;
      const next = e.key === 'ArrowDown'
        ? Math.min(start + 1, ids.length - 1)
        : Math.max(start - 1, 0);
      e.preventDefault();
      setSelected(ids[next]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, effectiveSelected]);

  // Keep the selected row visible as arrows move it.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [effectiveSelected]);

  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        background: 'var(--bg-1)',
        borderLeft: '1px solid var(--line-2)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: 'var(--s-1) var(--s-4)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <GitBranch size={13} strokeWidth={1.6} color="var(--dirty)" />
        <span className="eyebrow" style={{ color: 'var(--fg-0)' }}>Diff</span>
        <div style={{ flex: 1 }} />
        {totalFiles > 0 && <Chip dot="var(--dirty)">{totalFiles} {totalFiles === 1 ? 'file' : 'files'}</Chip>}
        <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={refresh} />
        <IconButton icon={Maximize2} label="Expand" size="sm" onClick={() => onExpand(effectiveSelected ?? undefined)} />
      </div>

      {/* File list — capped so the inline preview gets room */}
      <div className="argus-scroll" style={{ flex: '0 1 auto', maxHeight: '45%', overflow: 'auto', padding: 'var(--s-2) 0' }}>
        {isLoading && totalFiles === 0 && <LoadingState label="Loading diff" />}
        {notAGitRepo && !isLoading && (
          <EmptyState
            icon={GitBranch}
            title="Not a git repo"
            hint="This folder isn't tracked by git."
          />
        )}
        {error && !notAGitRepo && !isLoading && (
          <ErrorState title="Diff failed" detail={error} onRetry={refresh} />
        )}
        {!isLoading && !error && totalFiles === 0 && (
          <EmptyState
            icon={GitCommit}
            title="No changes"
            hint="Working tree is clean."
          />
        )}
        {items.map((it) => {
          const sel = it.id === effectiveSelected;
          return (
            <button
              key={it.id}
              ref={sel ? selectedRowRef : undefined}
              onClick={() => setSelected(it.id)}
              onDoubleClick={() => onExpand(it.id)}
              title="Click to preview · double-click to open"
              style={{
                all: 'unset',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--s-2)',
                padding: '6px var(--s-4)',
                width: '100%',
                boxSizing: 'border-box',
                background: sel ? 'var(--bg-2)' : 'transparent',
                borderLeft: `2px solid ${sel ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              <File size={12} strokeWidth={1.6} color={sel ? 'var(--accent)' : 'var(--fg-3)'} />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--t-tiny)',
                  color: sel ? 'var(--accent)' : it.source === 'untracked' ? 'var(--fg-2)' : 'var(--fg-1)',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {it.path}
              </span>
              {it.source === 'untracked' && <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>UNTRACKED</span>}
              {it.source !== 'untracked' && it.isNew && <span className="eyebrow" style={{ color: 'var(--accent)' }}>NEW</span>}
              {it.isDeleted && <span className="eyebrow" style={{ color: 'var(--danger)' }}>DEL</span>}
              {it.source !== 'untracked' && (
                <>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--ok)' }}>+{it.add}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--danger)' }}>−{it.del}</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* Inline preview of the selected file */}
      {selectedItem && (
        <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column' }}>
          {selectedItem.source === 'untracked' ? (
            <UntrackedPlaceholder
              path={selectedItem.path}
              staging={false}
              onStage={() => onExpand(selectedItem.id)}
            />
          ) : (
            <div className="argus-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg-0)' }}>
              {/* max-content lets long lines scroll horizontally instead of wrapping/clipping */}
              <div style={{ minWidth: 'max-content' }}>
                <DiffViewer file={selectedItem} mode="unified" />
              </div>
            </div>
          )}
        </div>
      )}

      {totalFiles > 0 && (
        <div style={{ padding: 'var(--s-3) var(--s-4)', borderTop: '1px solid var(--line-2)', flexShrink: 0 }}>
          <Button variant="primary" full icon={GitCommit} onClick={onCommit ?? (() => onExpand())}>
            Commit · {totalFiles} file{totalFiles !== 1 ? 's' : ''}
          </Button>
        </div>
      )}
    </aside>
  );
}
