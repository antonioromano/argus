import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import parseDiff from 'parse-diff';
import { X, GitBranch, RefreshCw, GitCommit, AlignLeft, SplitSquareHorizontal, Plus, FileText, Check, Minus, EyeOff, RotateCcw, Shrink } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useGitDiff } from '../../hooks/useGitDiff.js';
import { useCommitSelection } from '../../hooks/useCommitSelection.js';
import { useDiffInlineEdit } from '../../hooks/useDiffInlineEdit.js';
import { SplitDiff } from '../overlays/SplitDiff.js';
import { BlockGutterCell } from '../overlays/diff/BlockGutterCell.js';
import {
  type ChangeBlock,
  collectAllBlockHashes,
  resolveSelectionToChunkIndices,
  segmentChangeBlocks,
} from '../overlays/diff/changeBlocks.js';
import { api } from '../../services/api.js';
import {
  IconButton,
  Button,
  Chip,
  LoadingState,
  EmptyState,
  ErrorState,
  Tooltip,
} from '../../components/primitives/index.js';

interface DiffWorkbenchProps {
  session: SessionInfo;
  /** Close the tool window entirely (return to plain terminal focus). */
  onClose: () => void;
  /** Collapse the maximized tool window back to the docked right rail (⤡). */
  onRestore?: () => void;
  initialFile?: string;
}

type Source = 'unstaged' | 'staged';
// 'branch' is produced only by DiffSidePanel, which reuses this type + DiffViewer.
type SidebarSource = Source | 'untracked' | 'branch';

export interface FileSummary {
  path: string;
  add: number;
  del: number;
  source: SidebarSource;
  isNew: boolean;
  isDeleted: boolean;
  raw: string; // empty string for untracked
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

export function DiffWorkbench({ session, onClose, onRestore, initialFile }: DiffWorkbenchProps) {
  const { diff, isLoading, error, refresh } = useGitDiff({
    sessionId: session.id,
    isOpen: true,
    sessionStatus: session.status,
  });
  const selection = useCommitSelection({ sessionId: session.id, isOpen: true });
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [selectedFile, setSelectedFile] = useState<string | null>(initialFile ?? null);
  const [stagingPath, setStagingPath] = useState<string | null>(null);
  const [unstagingPath, setUnstagingPath] = useState<string | null>(null);
  const [ignoringPath, setIgnoringPath] = useState<string | null>(null);
  const [pendingRevertFile, setPendingRevertFile] = useState<string | null>(null);
  const [revertingFilePath, setRevertingFilePath] = useState<string | null>(null);
  const [skipConfirmFile, setSkipConfirmFile] = useState(() => localStorage.getItem('argus.revert.skipConfirm') === '1');
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const files = useMemo((): FileSummary[] => {
    if (!diff) return [];
    const untracked: FileSummary[] = (diff.untracked ?? []).map((p) => ({
      path: p,
      add: 0,
      del: 0,
      source: 'untracked' as const,
      isNew: true,
      isDeleted: false,
      raw: '',
    }));
    return [
      ...summarize(diff.unstaged, 'unstaged'),
      ...summarize(diff.staged, 'staged'),
      ...untracked,
    ];
  }, [diff]);

  const total = files.length;

  // Pre-compute hash sets per UNSTAGED file once per diff render.
  const hashesByFile = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const f of files) {
      if (f.source !== 'unstaged') continue;
      const parsed = parseDiff(f.raw).find((p) => (p.to ?? p.from) === f.path);
      if (!parsed) continue;
      m.set(f.path, collectAllBlockHashes(f.path, parsed));
    }
    return m;
  }, [files]);

  // GC stale selection hashes whenever the diff data refreshes.
  useEffect(() => {
    if (!diff) return;
    const validByFile = new Map<string, Set<string>>();
    for (const f of files) {
      if (f.source !== 'unstaged') continue;
      const parsed = parseDiff(f.raw).find((p) => (p.to ?? p.from) === f.path);
      if (!parsed) continue;
      validByFile.set(f.path, collectAllBlockHashes(f.path, parsed));
    }
    selection.gcStale(validByFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff]);

  const stageUntracked = async (path: string) => {
    setStagingPath(path);
    try {
      await api.gitAdd(session.id, path);
      await refresh();
    } finally {
      setStagingPath(null);
    }
  };

  const unstageFile = async (path: string) => {
    setUnstagingPath(path);
    try {
      await api.gitUnstage(session.id, path);
      await refresh();
    } finally {
      setUnstagingPath(null);
    }
  };

  const ignoreFile = async (path: string) => {
    setIgnoringPath(path);
    try {
      await api.gitIgnore(session.id, path);
      await refresh();
    } finally {
      setIgnoringPath(null);
    }
  };

  const handleRevertFile = async (f: FileSummary) => {
    const parsed = parseDiff(f.raw).find((p) => (p.to ?? p.from) === f.path);
    if (!parsed) return;
    const allHashes = hashesByFile.get(f.path) ?? new Set<string>();
    const chunks = resolveSelectionToChunkIndices(f.path, parsed, allHashes);
    if (chunks.length === 0) return;
    setRevertingFilePath(f.path);
    try {
      const result = await api.discardPatch(session.id, {
        filePath: f.path,
        fromPath: parsed.from && parsed.from !== f.path ? parsed.from : undefined,
        source: 'unstaged',
        chunks,
      });
      if (result.success) {
        selection.clearForFiles([f.path]);
        await refresh();
      }
    } finally {
      setRevertingFilePath(null);
      setPendingRevertFile(null);
    }
  };

  const toggleSkipConfirmFile = () => {
    const next = !skipConfirmFile;
    setSkipConfirmFile(next);
    if (next) localStorage.setItem('argus.revert.skipConfirm', '1');
    else localStorage.removeItem('argus.revert.skipConfirm');
  };

  const handleToggle = (filePath: string) => (block: ChangeBlock) => {
    selection.toggle(filePath, block.hash);
  };

  const handleRevert = (filePath: string, fromPath?: string) => async (block: ChangeBlock) => {
    const result = await api.discardPatch(session.id, {
      filePath,
      fromPath,
      source: 'unstaged',
      chunks: [{ chunkIndex: block.chunkIndex, selectedChangeIndices: block.changeIndicesInChunk }],
    });
    if (result.success) {
      selection.uncheck(filePath, block.hash); // hash no longer exists post-revert; drop it unconditionally
      await refresh();
    }
  };

  const startCommit = () => {
    setCommitError(null);
    setCommitMessage('');
    setCommitOpen(true);
  };

  const submitCommit = async () => {
    const msg = commitMessage.trim();
    if (!msg) {
      setCommitError('Commit message required');
      return;
    }
    setCommitting(true);
    setCommitError(null);
    try {
      const filesByPath = new Map<string, FileSummary>();
      for (const f of files) if (f.source === 'unstaged') filesByPath.set(f.path, f);

      const stagedPaths: string[] = [];
      for (const [filePath, hashes] of selection.checkedHashesByFile) {
        if (hashes.size === 0) continue;
        const summary = filesByPath.get(filePath);
        if (!summary) continue;
        const parsed = parseDiff(summary.raw).find((p) => (p.to ?? p.from) === filePath);
        if (!parsed) continue;
        const chunks = resolveSelectionToChunkIndices(filePath, parsed, hashes);
        if (chunks.length === 0) continue;
        const stage = await api.stagePatch(session.id, {
          filePath,
          fromPath: parsed.from && parsed.from !== filePath ? parsed.from : undefined,
          source: 'unstaged',
          chunks,
        });
        if (!stage.success) throw new Error(stage.error || `Stage failed for ${filePath}`);
        stagedPaths.push(filePath);
      }
      if (stagedPaths.length === 0) throw new Error('No checked blocks to commit');
      const commit = await api.commitWithFiles(session.id, msg, false, stagedPaths);
      if (!commit.success) throw new Error(commit.error || 'Commit failed');
      selection.clearForFiles(stagedPaths);
      setCommitOpen(false);
      setCommitMessage('');
      await refresh();
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  };

  const effectiveSelected: string | null = useMemo(() => {
    if (selectedFile && files.some((f) => `${f.source}::${f.path}` === selectedFile)) {
      return selectedFile;
    }
    if (files.length > 0) return `${files[0].source}::${files[0].path}`;
    return null;
  }, [files, selectedFile]);

  const selectedFileSummary: FileSummary | undefined = useMemo(() => {
    if (!effectiveSelected) return undefined;
    return files.find((f) => `${f.source}::${f.path}` === effectiveSelected);
  }, [files, effectiveSelected]);

  // Up/Down arrows move the selected file through the flat (unstaged → staged →
  // untracked) list. Ignored while the commit popover is open or focus is in an
  // editable field so the inline-edit caret and commit textarea keep the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (commitOpen) return;
      const t = document.activeElement as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (files.length === 0) return;
      const ids = files.map((f) => `${f.source}::${f.path}`);
      const cur = effectiveSelected ? ids.indexOf(effectiveSelected) : -1;
      const start = cur >= 0 ? cur : 0;
      const next = e.key === 'ArrowDown'
        ? Math.min(start + 1, ids.length - 1)
        : Math.max(start - 1, 0);
      e.preventDefault();
      setSelectedFile(ids[next]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [files, effectiveSelected, commitOpen]);

  // Keep the selected file row visible in the sidebar as arrows move it.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [effectiveSelected]);

  const editTargetPath: string | null = useMemo(() => {
    if (!selectedFileSummary || selectedFileSummary.source !== 'unstaged') return null;
    if (selectedFileSummary.isDeleted) return null;
    const base = session.folderPath.replace(/\/$/, '');
    return `${base}/${selectedFileSummary.path}`;
  }, [selectedFileSummary, session.folderPath]);

  const inlineEdit = useDiffInlineEdit({
    sessionId: session.id,
    absolutePath: editTargetPath,
    enabled: !!editTargetPath,
  });

  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-0)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
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
        {total > 0 && <Chip dot="var(--dirty)">{total} {total === 1 ? 'file' : 'files'}</Chip>}
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
        {selection.totalChecked > 0 && (
          <Chip dot="var(--accent)">{selection.totalChecked} checked</Chip>
        )}
        <Button
          variant="primary"
          icon={GitCommit}
          size="sm"
          disabled={selection.totalChecked === 0 || committing}
          onClick={startCommit}
        >
          Commit
        </Button>
        {onRestore && <IconButton icon={Shrink} label="Restore to side panel" size="sm" onClick={onRestore} />}
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
          {(['unstaged', 'staged', 'untracked'] as const).map((src) => {
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
                  const allHashes = f.source === 'unstaged' ? hashesByFile.get(f.path) : undefined;
                  const checkedSet = selection.checkedHashesByFile.get(f.path);
                  const checkedCount = checkedSet?.size ?? 0;
                  const totalBlocks = allHashes?.size ?? 0;
                  const fileState: 'none' | 'partial' | 'all' =
                    !allHashes || totalBlocks === 0
                      ? 'none'
                      : checkedCount === 0
                        ? 'none'
                        : checkedCount >= totalBlocks
                          ? 'all'
                          : 'partial';
                  const isHovered = hoveredFile === f.path;
                  const isConfirming = pendingRevertFile === f.path;
                  const isReverting = revertingFilePath === f.path;
                  return (
                    <Fragment key={id}>
                      <button
                        ref={sel ? selectedRowRef : undefined}
                        onClick={() => setSelectedFile(id)}
                        onMouseEnter={() => setHoveredFile(f.path)}
                        onMouseLeave={() => setHoveredFile(null)}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--s-2)',
                          padding: '0 var(--s-4)',
                          height: 28,
                          width: '100%',
                          boxSizing: 'border-box',
                          background: isConfirming ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : sel ? 'var(--bg-2)' : 'transparent',
                          borderLeft: `2px solid ${isConfirming ? 'var(--danger)' : sel ? 'var(--accent)' : 'transparent'}`,
                          boxShadow: sel ? 'var(--shadow-1)' : 'none',
                        }}
                      >
                        <FileCheckbox
                          visible={f.source === 'unstaged'}
                          state={fileState}
                          disabled={!allHashes || totalBlocks === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!allHashes) return;
                            if (fileState === 'all') {
                              selection.setBlocksForFile(f.path, []);
                            } else {
                              selection.setBlocksForFile(f.path, [...allHashes]);
                            }
                          }}
                        />
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
                        {f.source === 'untracked' && <span className="eyebrow" style={{ color: 'var(--accent)' }}>UNTRACKED</span>}
                        {f.source !== 'untracked' && f.isNew && <span className="eyebrow" style={{ color: 'var(--accent)' }}>NEW</span>}
                        {f.isDeleted && <span className="eyebrow" style={{ color: 'var(--danger)' }}>DEL</span>}
                        {f.source !== 'untracked' && !isHovered && !isConfirming && (
                          <>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--ok)' }}>+{f.add}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--danger)' }}>−{f.del}</span>
                          </>
                        )}
                        {f.source === 'unstaged' && (isHovered || isConfirming) && (
                          <SidebarChipButton
                            label={isReverting ? 'REVERTING…' : 'REVERT'}
                            icon={RotateCcw}
                            tone="danger"
                            busy={isReverting}
                            title="Revert all changes in this file"
                            onActivate={() => {
                              if (skipConfirmFile) {
                                void handleRevertFile(f);
                              } else {
                                setPendingRevertFile(f.path);
                              }
                            }}
                          />
                        )}
                        {f.source === 'untracked' && isHovered && (
                          <>
                            <SidebarChipButton
                              label={stagingPath === f.path ? 'STAGING…' : 'STAGE'}
                              icon={Plus}
                              tone="accent"
                              busy={stagingPath === f.path}
                              title="Stage (track) this file"
                              onActivate={() => stageUntracked(f.path)}
                            />
                            <SidebarChipButton
                              label={ignoringPath === f.path ? 'IGNORING…' : 'IGNORE'}
                              icon={EyeOff}
                              tone="muted"
                              busy={ignoringPath === f.path}
                              title="Add to .gitignore"
                              onActivate={() => ignoreFile(f.path)}
                            />
                          </>
                        )}
                        {f.source === 'staged' && (
                          <SidebarChipButton
                            label={unstagingPath === f.path ? 'UNSTAGING…' : 'UNSTAGE'}
                            icon={Minus}
                            tone="muted"
                            busy={unstagingPath === f.path}
                            title="Unstage this file"
                            onActivate={() => unstageFile(f.path)}
                          />
                        )}
                      </button>
                      {isConfirming && (
                        <div style={{
                          padding: '8px var(--s-4)',
                          background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
                          borderLeft: '2px solid var(--danger)',
                          borderTop: '1px solid color-mix(in srgb, var(--danger) 20%, transparent)',
                        }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', color: 'var(--fg-1)', marginBottom: 8 }}>
                            Revert all changes? Cannot be undone.
                          </div>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, cursor: 'pointer', userSelect: 'none' }}>
                            <span
                              role="checkbox"
                              aria-checked={skipConfirmFile}
                              onClick={(e) => { e.stopPropagation(); toggleSkipConfirmFile(); }}
                              style={{
                                width: 13, height: 13, flexShrink: 0,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                borderRadius: 2,
                                border: `1px solid ${skipConfirmFile ? 'var(--accent)' : 'var(--line-3)'}`,
                                background: skipConfirmFile ? 'var(--accent)' : 'var(--bg-2)',
                                color: skipConfirmFile ? 'var(--bg-0)' : 'transparent',
                              }}
                            >
                              {skipConfirmFile && <Check size={9} strokeWidth={2.5} />}
                            </span>
                            <span style={{ fontSize: 'var(--t-tiny)', color: 'var(--fg-2)' }}>Don't ask again</span>
                          </label>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => setPendingRevertFile(null)}
                              style={{
                                all: 'unset', cursor: 'pointer',
                                padding: '3px 10px', borderRadius: 'var(--r-2)',
                                border: '1px solid var(--line-3)', color: 'var(--fg-2)',
                                fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)',
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => void handleRevertFile(f)}
                              disabled={isReverting}
                              style={{
                                all: 'unset', cursor: isReverting ? 'wait' : 'pointer',
                                padding: '3px 10px', borderRadius: 'var(--r-2)',
                                background: 'var(--danger)', color: '#fff',
                                fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)',
                              }}
                            >
                              {isReverting ? 'Reverting…' : 'Revert file'}
                            </button>
                          </div>
                        </div>
                      )}
                    </Fragment>
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
            if (!selected) {
              return (
                <div style={{ padding: 'var(--s-7)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
                  {isLoading ? 'Loading diff…' : 'No files to view.'}
                </div>
              );
            }
            if (selected.source === 'untracked') {
              return (
                <UntrackedPlaceholder
                  path={selected.path}
                  staging={stagingPath === selected.path}
                  onStage={() => stageUntracked(selected.path)}
                />
              );
            }
            return (
              <DiffViewer
                file={selected}
                mode={viewMode}
                selection={
                  selected.source === 'unstaged'
                    ? {
                        isChecked: selection.isChecked,
                        toggle: handleToggle(selected.path),
                        revert: handleRevert(selected.path),
                      }
                    : undefined
                }
                editProps={
                  selected.source === 'unstaged' && inlineEdit.ready
                    ? { editLine: inlineEdit.editLine }
                    : undefined
                }
                editStatus={
                  selected.source === 'unstaged'
                    ? { saving: inlineEdit.saving, error: inlineEdit.error }
                    : undefined
                }
              />
            );
          })()}
        </main>
      </div>

      {commitOpen && (
        <CommitPopover
          message={commitMessage}
          onMessageChange={setCommitMessage}
          onCancel={() => setCommitOpen(false)}
          onSubmit={submitCommit}
          submitting={committing}
          error={commitError}
          fileCount={selection.checkedHashesByFile.size}
          blockCount={selection.totalChecked}
        />
      )}
    </div>
  );
}

interface FileCheckboxProps {
  visible: boolean;
  state: 'none' | 'partial' | 'all';
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
}

function FileCheckbox({ visible, state, disabled, onClick }: FileCheckboxProps) {
  if (!visible) {
    return <span style={{ width: 14, height: 14, flexShrink: 0 }} aria-hidden />;
  }
  const filled = state !== 'none';
  return (
    <Tooltip content={state === 'all' ? 'Uncheck all blocks in this file' : 'Check all blocks in this file'}>
      <span
        role="checkbox"
        aria-checked={state === 'all' ? 'true' : state === 'partial' ? 'mixed' : 'false'}
        tabIndex={0}
        onClick={disabled ? undefined : onClick}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(e as unknown as React.MouseEvent);
          }
        }}
        style={{
          width: 14,
          height: 14,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--r-2)',
          border: `1px solid ${filled ? 'var(--accent)' : 'var(--line-3)'}`,
          background: filled ? 'var(--accent)' : 'transparent',
          color: filled ? 'var(--bg-0)' : 'var(--fg-3)',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {state === 'all' && <Check size={10} strokeWidth={2.5} />}
        {state === 'partial' && (
          <span
            style={{
              width: 7,
              height: 2,
              background: 'var(--bg-0)',
              borderRadius: 1,
              display: 'inline-block',
            }}
          />
        )}
      </span>
    </Tooltip>
  );
}

interface SidebarChipButtonProps {
  label: string;
  icon: LucideIcon;
  tone: 'accent' | 'muted' | 'danger';
  busy: boolean;
  title: string;
  onActivate: () => void;
}

function SidebarChipButton({ label, icon: Icon, tone, busy, title, onActivate }: SidebarChipButtonProps) {
  const color = busy
    ? 'var(--fg-3)'
    : tone === 'accent'
      ? 'var(--accent)'
      : tone === 'danger'
        ? 'var(--danger)'
        : 'var(--fg-2)';
  return (
    <Tooltip content={title}>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          if (!busy) onActivate();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            if (!busy) onActivate();
          }
        }}
        style={{
          cursor: busy ? 'wait' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: '2px 6px',
          borderRadius: 'var(--r-2)',
          border: '1px solid var(--line-3)',
          color,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-micro)',
        }}
      >
        <Icon size={10} strokeWidth={2} />
        {label}
      </span>
    </Tooltip>
  );
}

export function UntrackedPlaceholder({
  path,
  staging,
  onStage,
}: {
  path: string;
  staging: boolean;
  onStage: () => void;
}) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--s-3)',
        color: 'var(--fg-2)',
        padding: 'var(--s-7)',
      }}
    >
      <FileText size={28} strokeWidth={1.3} color="var(--fg-3)" />
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>{path}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)', color: 'var(--fg-3)' }}>
        Untracked file — no diff to display.
      </div>
      <Button variant="primary" icon={Plus} size="sm" onClick={onStage} disabled={staging}>
        {staging ? 'Staging…' : 'Stage to start tracking'}
      </Button>
    </div>
  );
}

interface CommitPopoverProps {
  message: string;
  onMessageChange: (s: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  fileCount: number;
  blockCount: number;
}

function CommitPopover({ message, onMessageChange, onCancel, onSubmit, submitting, error, fileCount, blockCount }: CommitPopoverProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 56,
        right: 16,
        zIndex: 30,
        width: 360,
        background: 'var(--bg-0)',
        border: '1px solid var(--line-3)',
        borderRadius: 'var(--r-3)',
        boxShadow: 'var(--shadow-sheet)',
        padding: 'var(--s-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-2)',
      }}
    >
      <div className="eyebrow" style={{ color: 'var(--accent)' }}>
        COMMIT · {blockCount} BLOCK{blockCount === 1 ? '' : 'S'} IN {fileCount} FILE{fileCount === 1 ? '' : 'S'}
      </div>
      <textarea
        autoFocus
        value={message}
        onChange={(e) => onMessageChange(e.target.value)}
        placeholder="Commit message"
        rows={3}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-xs)',
          padding: 'var(--s-2)',
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-2)',
          color: 'var(--fg-0)',
          resize: 'vertical',
          minHeight: 60,
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      {error && (
        <div style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)' }}>{error}</div>
      )}
      <div style={{ display: 'flex', gap: 'var(--s-2)', justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button variant="primary" size="sm" icon={GitCommit} onClick={onSubmit} disabled={submitting || !message.trim()}>
          {submitting ? 'Committing…' : 'Commit'}
        </Button>
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

interface DiffViewerSelectionProps {
  isChecked: (filePath: string, hash: string) => boolean;
  toggle: (block: ChangeBlock) => void;
  revert: (block: ChangeBlock) => Promise<void> | void;
}

interface DiffViewerEditProps {
  editLine: (lineNo: number, text: string) => void;
}

interface DiffViewerEditStatus {
  saving: boolean;
  error: string | null;
}

export function DiffViewer({
  file,
  mode,
  selection,
  editProps,
  editStatus,
}: {
  file: FileSummary;
  mode: 'split' | 'unified';
  selection?: DiffViewerSelectionProps;
  editProps?: DiffViewerEditProps;
  editStatus?: DiffViewerEditStatus;
}) {
  const files = useMemo(() => parseDiff(file.raw), [file.raw]);
  const target = files.find((f) => (f.to ?? f.from) === file.path);
  if (!target) return null;
  return (
    <div style={{ padding: 'var(--s-4)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-xs)' }}>
      <div
        className="eyebrow"
        style={{ color: 'var(--accent)', marginBottom: 'var(--s-3)', display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}
      >
        <span>{file.path} · {mode.toUpperCase()}</span>
        {editStatus?.saving && <span style={{ color: 'var(--dirty)' }}>· SAVING…</span>}
        {editStatus?.error && <span style={{ color: 'var(--danger)' }}>· {editStatus.error}</span>}
      </div>
      {mode === 'split' ? (
        <SplitDiff
          target={target}
          selection={
            selection
              ? {
                  filePath: file.path,
                  isChecked: selection.isChecked,
                  onToggle: selection.toggle,
                  onRevert: selection.revert,
                }
              : undefined
          }
          edit={editProps}
        />
      ) : (
        target.chunks.map((chunk, i) => {
          const blocks = selection ? segmentChangeBlocks(file.path, i, chunk) : [];
          const blockByFirstChangeIdx = new Map<number, ChangeBlock>();
          if (selection) {
            // Map block.firstChangeIndex within chunk.changes (including ctx) to block.
            // Compute by walking chunk.changes alongside blocks.
            let nonCtx = 0;
            let blockCursor = 0;
            chunk.changes.forEach((c, idx) => {
              if (c.type === 'normal') return;
              const blk = blocks[blockCursor];
              if (blk && nonCtx === blk.changeIndicesInChunk[0]) {
                blockByFirstChangeIdx.set(idx, blk);
                blockCursor += 1;
              }
              nonCtx += 1;
            });
          }
          return (
          <div key={i} style={{ marginBottom: 'var(--s-4)' }}>
            <div style={{ color: 'var(--fg-3)', padding: '2px var(--s-2)', background: 'var(--bg-1)', borderRadius: 'var(--r-1)', marginBottom: 4 }}>
              {chunk.content}
            </div>
            {chunk.changes.map((c, j) => {
              const isAdd = c.type === 'add';
              const isDel = c.type === 'del';
              const block = selection ? blockByFirstChangeIdx.get(j) ?? null : null;
              const lineNo = isAdd
                ? (c as { ln?: number }).ln
                : isDel
                  ? undefined
                  : (c as { ln2?: number }).ln2;
              const canEdit = !!editProps && !isDel && lineNo != null;
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
                  {selection && (
                    <div style={{ width: 50, flexShrink: 0 }}>
                      <BlockGutterCell
                        block={block}
                        isChecked={block ? selection.isChecked(file.path, block.hash) : false}
                        onToggle={selection.toggle}
                        onRevert={selection.revert}
                      />
                    </div>
                  )}
                  <span style={{ width: 14, color: 'var(--fg-4)', flexShrink: 0 }}>
                    {isAdd ? '+' : isDel ? '−' : ' '}
                  </span>
                  {canEdit ? (
                    <span
                      contentEditable
                      suppressContentEditableWarning
                      spellCheck={false}
                      onInput={(e) => {
                        editProps!.editLine(lineNo as number, (e.currentTarget.textContent ?? '').replace(/\n/g, ''));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.preventDefault();
                      }}
                      style={{ outline: 'none', flex: 1, minWidth: 0 }}
                    >
                      {lineText(c)}
                    </span>
                  ) : (
                    <span>{lineText(c)}</span>
                  )}
                </div>
              );
            })}
          </div>
          );
        })
      )}
    </div>
  );
}
