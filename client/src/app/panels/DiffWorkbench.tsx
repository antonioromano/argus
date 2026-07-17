import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { X, GitBranch, RefreshCw, GitCommit, AlignLeft, SplitSquareHorizontal, Plus, Check, Minus, EyeOff, RotateCcw, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useGitDiff } from '../../hooks/useGitDiff.js';
import { useCommitSelection } from '../../hooks/useCommitSelection.js';
import {
  type ChangeBlock,
  collectAllBlockHashes,
  resolveSelectionToChunkIndices,
} from '../overlays/diff/changeBlocks.js';
import { type FileModel, modelsFromRaw, shouldAutoCollapse, estimateBodyHeight } from '../overlays/diff/diffModel.js';
import { RevertConfirmCard } from '../overlays/diff/ConfirmRevert.js';
import { useSkipRevertConfirm } from '../../hooks/useSkipRevertConfirm.js';
import { FileSection } from './FileSection.js';
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
  initialFile?: string;
  /** Open a file in the Monaco editor at a line (cmd+click go-to-def from the diff). */
  onOpenInEditor?: (filePath: string, line?: number) => void;
}

export function DiffWorkbench({ session, onClose, initialFile, onOpenInEditor }: DiffWorkbenchProps) {
  const { diff, isLoading, error, refresh } = useGitDiff({
    sessionId: session.id,
    isOpen: true,
    sessionStatus: session.status,
  });
  const selection = useCommitSelection({ sessionId: session.id, isOpen: true });
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  // Which file is "focused" — driven by scroll-spy, sidebar clicks and arrow keys.
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  // Sections within the render band (≈600px of the viewport) mount their heavy
  // diff body; the rest render a height-estimated placeholder.
  const [nearIds, setNearIds] = useState<Set<string>>(() => new Set());
  // Set during a click/arrow-driven smooth scroll so the IntersectionObserver
  // doesn't fight it as intermediate sections cross the viewport middle.
  const programmaticRef = useRef<{ id: string; until: number } | null>(null);
  const appliedInitialRef = useRef(false);
  const [stagingPath, setStagingPath] = useState<string | null>(null);
  const [unstagingPath, setUnstagingPath] = useState<string | null>(null);
  const [ignoringPath, setIgnoringPath] = useState<string | null>(null);
  const [pendingRevertFile, setPendingRevertFile] = useState<string | null>(null);
  const [revertingFilePath, setRevertingFilePath] = useState<string | null>(null);
  const { skip: skipConfirmFile, toggle: toggleSkipConfirmFile } = useSkipRevertConfirm();
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const selectedRowRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const registerRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) sectionRefs.current.set(id, el);
    else sectionRefs.current.delete(id);
  }, []);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  // Parse each diff group exactly once. Memoizing per group keeps a poll that
  // only touched one group from re-parsing (and changing the identity of) the
  // others — important now that every file is mounted in the scroll view.
  const unstagedModels = useMemo(() => modelsFromRaw(diff?.unstaged ?? '', 'unstaged'), [diff?.unstaged]);
  const stagedModels = useMemo(() => modelsFromRaw(diff?.staged ?? '', 'staged'), [diff?.staged]);
  const untrackedModels = useMemo(() => modelsFromRaw(diff?.untrackedDiff ?? '', 'untracked'), [diff?.untrackedDiff]);
  const files = useMemo(
    () => [...unstagedModels, ...stagedModels, ...untrackedModels],
    [unstagedModels, stagedModels, untrackedModels],
  );

  const total = files.length;

  // Pre-compute hash sets per UNSTAGED file from the already-parsed diff.
  const hashesByFile = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const f of files) {
      if (f.source !== 'unstaged') continue;
      m.set(f.path, collectAllBlockHashes(f.path, f.parsed));
    }
    return m;
  }, [files]);

  // GC stale selection hashes whenever the diff data refreshes.
  useEffect(() => {
    if (!diff) return;
    const validByFile = new Map<string, Set<string>>();
    for (const f of files) {
      if (f.source !== 'unstaged') continue;
      validByFile.set(f.path, collectAllBlockHashes(f.path, f.parsed));
    }
    selection.gcStale(validByFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

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

  const handleRevertFile = async (f: FileModel) => {
    const allHashes = hashesByFile.get(f.path) ?? new Set<string>();
    const chunks = resolveSelectionToChunkIndices(f.path, f.parsed, allHashes);
    if (chunks.length === 0) return;
    setRevertingFilePath(f.path);
    try {
      const result = await api.discardPatch(session.id, {
        filePath: f.path,
        fromPath: f.fromPath,
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

  const submitCommit = async (push = false) => {
    const msg = commitMessage.trim();
    if (!msg) {
      setCommitError('Commit message required');
      return;
    }
    if (push) setPushing(true);
    else setCommitting(true);
    setCommitError(null);
    try {
      const filesByPath = new Map<string, FileModel>();
      for (const f of files) if (f.source === 'unstaged') filesByPath.set(f.path, f);

      const stagedPaths: string[] = [];
      for (const [filePath, hashes] of selection.checkedHashesByFile) {
        if (hashes.size === 0) continue;
        const model = filesByPath.get(filePath);
        if (!model) continue;
        const chunks = resolveSelectionToChunkIndices(filePath, model.parsed, hashes);
        if (chunks.length === 0) continue;
        const stage = await api.stagePatch(session.id, {
          filePath,
          fromPath: model.fromPath,
          source: 'unstaged',
          chunks,
        });
        if (!stage.success) throw new Error(stage.error || `Stage failed for ${filePath}`);
        stagedPaths.push(filePath);
      }
      if (stagedPaths.length === 0) throw new Error('No checked blocks to commit');
      const commit = await api.commitWithFiles(session.id, msg, false, stagedPaths);
      if (!commit.success) throw new Error(commit.error || 'Commit failed');
      if (push) {
        const pushed = await api.gitPush(session.id);
        if (!pushed.success) throw new Error(pushed.error || 'Push failed');
      }
      selection.clearForFiles(stagedPaths);
      setCommitOpen(false);
      setCommitMessage('');
      await refresh();
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : push ? 'Push failed' : 'Commit failed');
    } finally {
      setCommitting(false);
      setPushing(false);
    }
  };

  // Resolve the highlighted file: the scroll-spy/arrow/click value when valid,
  // else the first file so the sidebar always shows a selection.
  const resolvedActiveId: string | null = useMemo(() => {
    if (activeFileId && files.some((f) => f.id === activeFileId)) return activeFileId;
    return files.length > 0 ? files[0].id : null;
  }, [files, activeFileId]);

  // Scroll a file's section into view and mark it active, suppressing the
  // observer briefly so it doesn't re-pick intermediate sections mid-animation.
  const scrollToFile = useCallback((id: string) => {
    const el = sectionRefs.current.get(id);
    setActiveFileId(id);
    if (!el) return;
    programmaticRef.current = { id, until: Date.now() + 700 };
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Scroll-spy: highlight whichever section crosses the viewport's vertical
  // middle. One observer rooted on <main>, observing section roots.
  useEffect(() => {
    const root = mainRef.current;
    if (!root || files.length === 0) return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.fileId;
          if (!id) continue;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const prog = programmaticRef.current;
        if (prog) {
          if (Date.now() < prog.until) return; // still animating to a clicked target
          programmaticRef.current = null;
        }
        const next = files.find((f) => visible.has(f.id))?.id;
        if (next) setActiveFileId((cur) => (cur === next ? cur : next));
      },
      { root, rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    for (const f of files) {
      const el = sectionRefs.current.get(f.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [files]);

  // Render-band observer: mount bodies for sections within ~600px of the
  // viewport. Its initial callback populates the band on mount, so no separate
  // seeding is needed; ids of removed files linger harmlessly (never rendered).

  useEffect(() => {
    const root = mainRef.current;
    if (!root || files.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        setNearIds((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.fileId;
            if (!id) continue;
            if (e.isIntersecting && !next.has(id)) { next.add(id); changed = true; }
            else if (!e.isIntersecting && next.has(id)) { next.delete(id); changed = true; }
          }
          return changed ? next : prev;
        });
      },
      { root, rootMargin: '600px 0px 600px 0px', threshold: 0 },
    );
    for (const f of files) {
      const el = sectionRefs.current.get(f.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [files]);

  // A real wheel gesture cancels the click/arrow suppression window early.
  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    const clear = () => { programmaticRef.current = null; };
    root.addEventListener('wheel', clear, { passive: true });
    return () => root.removeEventListener('wheel', clear);
  }, []);

  // Honor an initialFile by scrolling to it once the sections have mounted.
  useEffect(() => {
    if (appliedInitialRef.current || !initialFile || files.length === 0) return;
    const match = files.find((f) => f.path === initialFile);
    if (!match) return;
    appliedInitialRef.current = true;
    requestAnimationFrame(() => scrollToFile(match.id));
  }, [files, initialFile, scrollToFile]);

  // Up/Down arrows step between file sections. Ignored while the commit popover
  // is open or focus is in an editable field so the inline-edit caret and commit
  // textarea keep the keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (commitOpen) return;
      const t = document.activeElement as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (files.length === 0) return;
      const ids = files.map((f) => f.id);
      const cur = resolvedActiveId ? ids.indexOf(resolvedActiveId) : -1;
      const start = cur >= 0 ? cur : 0;
      const next = e.key === 'ArrowDown'
        ? Math.min(start + 1, ids.length - 1)
        : Math.max(start - 1, 0);
      e.preventDefault();
      scrollToFile(ids[next]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [files, resolvedActiveId, commitOpen, scrollToFile]);

  // Keep the active file's sidebar row visible as it changes.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [resolvedActiveId]);

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
                  const id = f.id;
                  const sel = resolvedActiveId === id;
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
                        onClick={() => scrollToFile(id)}
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
                        <div
                          style={{
                            padding: '8px var(--s-4)',
                            background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
                            borderLeft: '2px solid var(--danger)',
                            borderTop: '1px solid color-mix(in srgb, var(--danger) 20%, transparent)',
                          }}
                        >
                          <RevertConfirmCard
                            title="Revert all changes?"
                            subtitle="Cannot be undone."
                            confirmLabel={isReverting ? 'Reverting' : 'Revert file'}
                            busy={isReverting}
                            skip={skipConfirmFile}
                            onToggleSkip={toggleSkipConfirmFile}
                            onCancel={() => setPendingRevertFile(null)}
                            onConfirm={() => void handleRevertFile(f)}
                          />
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            );
          })}
        </aside>

        <main ref={mainRef} style={{ flex: 1, minWidth: 0, background: 'var(--bg-0)', overflow: 'auto' }} className="argus-scroll">
          {total === 0 ? (
            <div style={{ padding: 'var(--s-7)', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
              {isLoading ? 'Loading diff…' : 'No files to view.'}
            </div>
          ) : (
            files.map((f) => {
              const allHashes = f.source === 'unstaged' ? hashesByFile.get(f.path) : undefined;
              const checkedCount = selection.checkedHashesByFile.get(f.path)?.size ?? 0;
              const totalBlocks = allHashes?.size ?? 0;
              const acceptState: 'none' | 'partial' | 'all' =
                !allHashes || totalBlocks === 0 || checkedCount === 0
                  ? 'none'
                  : checkedCount >= totalBlocks
                    ? 'all'
                    : 'partial';
              return (
                <FileSection
                  key={f.id}
                  file={f}
                  sessionId={session.id}
                  folderPath={session.folderPath}
                  onOpenInEditor={onOpenInEditor}
                  mode={viewMode}
                  active={resolvedActiveId === f.id}
                  registerRef={registerRef}
                  defaultCollapsed={shouldAutoCollapse(f.parsed)}
                  renderBody={nearIds.has(f.id)}
                  estimatedBodyHeight={estimateBodyHeight(f.parsed)}
                  isChecked={selection.isChecked}
                  onToggleBlock={handleToggle(f.path)}
                  onRevertBlock={handleRevert(f.path, f.fromPath)}
                  acceptState={acceptState}
                  acceptDisabled={!allHashes || totalBlocks === 0}
                  onAccept={
                    f.source === 'unstaged'
                      ? () => {
                          if (!allHashes) return;
                          if (acceptState === 'all') selection.setBlocksForFile(f.path, []);
                          else selection.setBlocksForFile(f.path, [...allHashes]);
                        }
                      : undefined
                  }
                  onRollback={f.source === 'unstaged' ? () => handleRevertFile(f) : undefined}
                  rollbackBusy={revertingFilePath === f.path}
                  onStage={f.source === 'untracked' ? () => stageUntracked(f.path) : undefined}
                  stageBusy={stagingPath === f.path}
                  onIgnore={f.source === 'untracked' ? () => ignoreFile(f.path) : undefined}
                  ignoreBusy={ignoringPath === f.path}
                  onUnstage={f.source === 'staged' ? () => unstageFile(f.path) : undefined}
                  unstageBusy={unstagingPath === f.path}
                />
              );
            })
          )}
        </main>
      </div>

      {commitOpen && (
        <CommitPopover
          message={commitMessage}
          onMessageChange={setCommitMessage}
          onCancel={() => setCommitOpen(false)}
          onSubmit={() => submitCommit(false)}
          onSubmitAndPush={() => submitCommit(true)}
          committing={committing}
          pushing={pushing}
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

interface CommitPopoverProps {
  message: string;
  onMessageChange: (s: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onSubmitAndPush: () => void;
  committing: boolean;
  pushing: boolean;
  error: string | null;
  fileCount: number;
  blockCount: number;
}

function CommitPopover({ message, onMessageChange, onCancel, onSubmit, onSubmitAndPush, committing, pushing, error, fileCount, blockCount }: CommitPopoverProps) {
  const busy = committing || pushing;
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
          if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Enter') onSubmitAndPush();
          else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit();
          if (e.key === 'Escape') onCancel();
        }}
      />
      {error && (
        <div style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-tiny)' }}>{error}</div>
      )}
      <div style={{ display: 'flex', gap: 'var(--s-2)', justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="secondary" size="sm" icon={GitCommit} onClick={onSubmit} disabled={busy || !message.trim()}>
          {committing ? 'Committing…' : 'Commit'}
        </Button>
        <Button variant="primary" size="sm" icon={Upload} onClick={onSubmitAndPush} disabled={busy || !message.trim()}>
          {pushing ? 'Pushing…' : 'Commit & Push'}
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
