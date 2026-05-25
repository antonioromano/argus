import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import parseDiff from 'parse-diff';
import { GitCommit, Eye, Search, X, SplitSquareHorizontal, AlignLeft, EyeOff, FolderOpen, Terminal as TerminalIcon, WrapText } from 'lucide-react';
import type { GitDiffResponse, SessionInfo, GitBranchesResponse, PatchSelectionRequest, GitFileStatusCode } from '@argus/shared';
import { api } from '../services/api.js';
import { SessionSidebar } from './SessionSidebar.js';
import { ResizeDivider } from './ResizeDivider.js';
import { CommitBar } from './diff/CommitBar.js';
import { ChangelistFileList } from './diff/ChangelistFileList.js';
import { SideBySideDiffPane } from './diff/SideBySideDiffPane.js';
import { UnifiedDiffPane } from './diff/UnifiedDiffPane.js';
import { InlineIconLink } from './primitives/index.js';
import { useResizablePanel } from '../hooks/useResizablePanel.js';
import { useGitDiffPanel } from '../hooks/useGitDiffPanel.js';
import { useChangelists } from '../hooks/useChangelists.js';
import { useStructuredDiff } from '../hooks/useStructuredDiff.js';
import { MacDiffToolbar } from './mac/MacDiffToolbar.js';
import { MacDiffBranchSheet } from './mac/MacDiffBranchSheet.js';

const NARROW_BREAKPOINT = 520;

// SectionKey is needed for the props interface (initialCollapsedSections)
type SectionKey = 'unstaged' | 'staged' | 'branch' | 'untracked';

interface GitDiffPanelProps {
  diff: GitDiffResponse | null;
  theme: 'dark' | 'light';
  isLoading: boolean;
  error: string | null;
  isFullscreen: boolean;
  sessions: SessionInfo[];
  currentSessionId: string;
  onSelectSession: (id: string) => void;
  onClose: () => void;
  onToggleFullscreen: () => void;
  onRefresh: () => void;
  showHeaderControls?: boolean;
  showSessionSelector?: boolean;
  onOpenInExplorer?: (absolutePath: string) => void;
  /** Pre-fill the search filter (e.g. when navigating from Explorer with a file selected). */
  initialSearchQuery?: string;
  /** Restore previously collapsed sections (survives tab switches). */
  initialCollapsedSections?: Set<SectionKey>;
  /** Called when collapsed sections change — parent can cache. */
  onCollapsedSectionsChange?: (sections: Set<SectionKey>) => void;
  /** Whether the shared terminal is open. */
  showTerminal?: boolean;
  /** Toggle the shared terminal. */
  onToggleTerminal?: () => void;
  /** Expand context for a file (increases -U lines). */
  onExpandFileContext?: (filePath: string, source: 'unstaged' | 'staged' | 'branch') => void;
  /** Set of "source:filePath" keys currently being fetched. */
  expandingFiles?: Set<string>;
}

export function GitDiffPanel({
  diff,
  theme: _theme,
  isLoading,
  error,
  isFullscreen,
  sessions,
  currentSessionId,
  onSelectSession,
  onClose,
  onToggleFullscreen,
  onRefresh,
  showHeaderControls = true,
  showSessionSelector = true,
  onOpenInExplorer,
  initialSearchQuery,
  initialCollapsedSections: _initialCollapsedSections,
  onCollapsedSectionsChange: _onCollapsedSectionsChange,
  showTerminal,
  onToggleTerminal,
  onExpandFileContext: _onExpandFileContext,
  expandingFiles: _expandingFiles,
}: GitDiffPanelProps) {
  const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron');

  const containerRef = useRef<HTMLDivElement>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [sheetOpen, setSheetOpen] = useState(false);
  const touchStartRef = useRef(0);
  const [wordWrap, setWordWrap] = useState(() => localStorage.getItem('gitdiff-word-wrap') === 'true');

  // Branch toolbar state
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [behindCount, setBehindCount] = useState<number | undefined>(undefined);
  const [branchLoading, setBranchLoading] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchError, setBranchError] = useState('');
  const [showPullAndBranch, setShowPullAndBranch] = useState(false);
  const [pullBranchName, setPullBranchName] = useState('');
  const [pullBaseBranch, setPullBaseBranch] = useState('');
  const [showBranchSheet, setShowBranchSheet] = useState(false);

  // Panel-level state hook
  const panel = useGitDiffPanel();

  // Sync initialSearchQuery into panel search
  const prevInitialSearch = useRef(initialSearchQuery);
  useEffect(() => {
    if (initialSearchQuery !== undefined && initialSearchQuery !== prevInitialSearch.current) {
      panel.setSearchQuery(initialSearchQuery);
    }
    prevInitialSearch.current = initialSearchQuery;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSearchQuery]);

  // Resizable panels
  const { size: sidebarWidth, isDragging: isSidebarDragging, handleMouseDown: handleSidebarMouseDown } = useResizablePanel({
    containerRef,
    defaultSize: 200,
    minSize: 120,
    maxSize: 350,
    direction: 'left',
    unit: 'px',
    storageKey: 'gitdiff-sidebar-width',
  });

  const { size: fileListWidth, isDragging: isFileListDragging, handleMouseDown: handleFileListMouseDown } = useResizablePanel({
    containerRef: fileListRef,
    defaultSize: 220,
    minSize: 150,
    maxSize: 500,
    direction: 'left',
    unit: 'px',
    storageKey: 'gitdiff-filelist-width',
  });

  // Changelists
  const changelists = useChangelists(currentSessionId);

  // Git file statuses for ChangelistFileList
  const [gitStatuses, setGitStatuses] = useState<Record<string, GitFileStatusCode>>({});
  useEffect(() => {
    if (!currentSessionId) return;
    api.getGitFileStatuses(currentSessionId).then(res => {
      setGitStatuses(res.statuses ?? {});
    }).catch(() => {});
  }, [currentSessionId, diff]);

  // Structured diff for selected file
  const {
    data: structuredDiffData,
    loading: structuredDiffLoading,
    error: structuredDiffError,
    refetch: structuredDiffRefetch,
  } = useStructuredDiff(
    currentSessionId,
    panel.selectedFilePath,
    panel.contextLines,
    panel.selectedSource,
  );

  // Parse raw diff strings into file lists for the changelist panel
  const { stagedFiles, unstagedFiles, branchFiles, untrackedFiles, totalFiles, totalAdditions, totalDeletions } = useMemo(() => {
    const staged = diff?.staged ? parseDiff(diff.staged) : [];
    const unstaged = diff?.unstaged ? parseDiff(diff.unstaged) : [];
    const branch = diff?.branch ? parseDiff(diff.branch) : [];
    const untracked = diff?.untracked ?? [];
    let adds = 0;
    let dels = 0;
    for (const f of [...staged, ...unstaged]) {
      adds += f.additions;
      dels += f.deletions;
    }
    return {
      stagedFiles: staged,
      unstagedFiles: unstaged,
      branchFiles: branch,
      untrackedFiles: untracked,
      totalFiles: staged.length + unstaged.length + untracked.length,
      totalAdditions: adds,
      totalDeletions: dels,
    };
  }, [diff]);

  // Compute sets for ChangelistFileList
  const { changedFilePaths, stagedFilePaths, unstagedOnlyFilePaths } = useMemo(() => {
    const stagedSet = new Set(stagedFiles.map(f => f.to === '/dev/null' ? (f.from ?? '') : (f.to ?? '')));
    const unstagedSet = new Set(unstagedFiles.map(f => f.to === '/dev/null' ? (f.from ?? '') : (f.to ?? '')));
    const branchSet = new Set(branchFiles.map(f => f.to === '/dev/null' ? (f.from ?? '') : (f.to ?? '')));
    const untrackedSet = new Set(untrackedFiles);

    const all = new Set([...stagedSet, ...unstagedSet, ...branchSet, ...untrackedSet]);
    const unstagedOnly = new Set([...unstagedSet].filter(fp => !stagedSet.has(fp)));

    return {
      changedFilePaths: Array.from(all),
      stagedFilePaths: stagedSet,
      unstagedOnlyFilePaths: unstagedOnly,
    };
  }, [stagedFiles, unstagedFiles, branchFiles, untrackedFiles]);

  // Reconcile changelists when file list changes
  useEffect(() => {
    if (changedFilePaths.length === 0) return;
    changelists.reconcileWithStatus(new Set(changedFilePaths));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changedFilePaths.join(',')]);

  // Compute active changelist and staged files for CommitBar
  const activeChangelist = useMemo(() => {
    return changelists.state.lists.find(l => l.id === changelists.state.activeId)
      ?? changelists.state.lists[0];
  }, [changelists.state]);

  const stagedFilesInActiveList = useMemo(() => {
    if (!activeChangelist) return [];
    const activeFileKeys = activeChangelist.isDefault
      ? changedFilePaths
      : activeChangelist.fileKeys.filter(k => changedFilePaths.includes(k));
    return activeFileKeys.filter(fp => stagedFilePaths.has(fp));
  }, [activeChangelist, changedFilePaths, stagedFilePaths]);

  // Compute hiddenHunkIndices from search query
  const hiddenHunkIndices = useMemo(() => {
    if (!panel.searchQuery.trim() || !structuredDiffData?.hunks) return new Set<number>();
    const q = panel.searchQuery.toLowerCase();
    return new Set(
      structuredDiffData.hunks
        .map((hunk, i) => ({
          i,
          hasMatch: hunk.lines.some(l =>
            [...l.left.tokens, ...l.right.tokens].some(t => t.text.toLowerCase().includes(q))
          ),
        }))
        .filter(({ hasMatch }) => !hasMatch)
        .map(({ i }) => i)
    );
  }, [panel.searchQuery, structuredDiffData]);

  // Wire up next/prev hunk navigation to panel's refs
  useEffect(() => {
    const el = panel.panelRef.current;
    if (!el) return;

    panel.nextHunkRef.current = () => {
      const headers = Array.from(el.querySelectorAll<HTMLElement>('[data-hunk-header]'));
      if (headers.length === 0) return;
      const threshold = 8;
      const next = headers.find(h => h.getBoundingClientRect().top > threshold);
      next?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    panel.prevHunkRef.current = () => {
      const headers = Array.from(el.querySelectorAll<HTMLElement>('[data-hunk-header]'));
      if (headers.length === 0) return;
      const threshold = -8;
      const above = headers.filter(h => h.getBoundingClientRect().top < threshold);
      above[above.length - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
  });

  const isEmpty = !error && totalFiles === 0;
  const folderPath = sessions.find(s => s.id === currentSessionId)?.folderPath ?? '';

  // Detect container width to switch layouts
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setIsNarrow(entries[0].contentRect.width < NARROW_BREAKPOINT);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track mobile viewport
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ---- Branch toolbar functions (from original GitDiffPanel) ----

  const loadBranches = useCallback(async () => {
    if (!currentSessionId) return;
    try {
      const data: GitBranchesResponse = await api.getGitBranches(currentSessionId);
      setBranches(data.branches);
      setCurrentBranch(data.currentBranch);
      setBehindCount(data.behindCount);
    } catch {
      // silently ignore (non-git repos, etc.)
    }
  }, [currentSessionId]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  async function handleBranchChange(branch: string) {
    if (branchLoading || branch === currentBranch) return;
    setBranchLoading(true);
    setBranchError('');
    try {
      const result = await api.gitCheckout(currentSessionId, branch);
      if (result.success) {
        await loadBranches();
        onRefresh();
      } else {
        setBranchError(result.error ?? 'Checkout failed');
        setTimeout(() => setBranchError(''), 5000);
      }
    } finally {
      setBranchLoading(false);
    }
  }

  async function handleCreateBranch() {
    const name = newBranchName.trim();
    if (!name) return;
    if (/\s/.test(name)) {
      setBranchError('Branch name cannot contain spaces');
      return;
    }
    setBranchLoading(true);
    setBranchError('');
    try {
      const result = await api.gitCreateBranch(currentSessionId, name);
      if (result.success) {
        setCreatingBranch(false);
        setNewBranchName('');
        await loadBranches();
        onRefresh();
      } else {
        setBranchError(result.error ?? 'Create branch failed');
      }
    } finally {
      setBranchLoading(false);
    }
  }

  async function handlePull() {
    if (branchLoading) return;
    setBranchLoading(true);
    setBranchError('');
    try {
      const result = await api.gitPull(currentSessionId);
      if (result.success) {
        await loadBranches();
        onRefresh();
      } else {
        setBranchError(result.error ?? 'Pull failed');
        setTimeout(() => setBranchError(''), 5000);
      }
    } finally {
      setBranchLoading(false);
    }
  }

  async function createBranchDirect(name: string) {
    if (branchLoading) return;
    setBranchLoading(true);
    setBranchError('');
    try {
      const result = await api.gitCreateBranch(currentSessionId, name);
      if (result.success) {
        await loadBranches();
        onRefresh();
      } else {
        const msg = result.error ?? 'Create branch failed';
        setBranchError(msg);
        throw new Error(msg);
      }
    } finally {
      setBranchLoading(false);
    }
  }

  async function pullAndBranchDirect(name: string, baseBranch: string) {
    if (branchLoading) return;
    setBranchLoading(true);
    setBranchError('');
    try {
      const result = await api.gitPullAndBranch(currentSessionId, name, baseBranch || undefined);
      if (result.success) {
        await loadBranches();
        onRefresh();
      } else {
        const msg = result.error ?? 'Pull and branch failed';
        setBranchError(msg);
        throw new Error(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pull and branch failed';
      setBranchError(msg);
      throw err;
    } finally {
      setBranchLoading(false);
    }
  }

  async function handlePullAndBranch() {
    const name = pullBranchName.trim();
    if (!name || branchLoading) return;
    setBranchLoading(true);
    setBranchError('');
    try {
      const result = await api.gitPullAndBranch(currentSessionId, name, pullBaseBranch || undefined);
      if (result.success) {
        setShowPullAndBranch(false);
        setPullBranchName('');
        setPullBaseBranch('');
        await loadBranches();
        onRefresh();
      } else {
        setBranchError(result.error ?? 'Pull and branch failed');
      }
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : 'Pull and branch failed');
    } finally {
      setBranchLoading(false);
    }
  }

  // Stage/discard hunk actions
  const handleStageHunk = useCallback(async (hunkIndex: number) => {
    if (!panel.selectedFilePath || !structuredDiffData) return;
    const hunk = structuredDiffData.hunks[hunkIndex];
    if (!hunk) return;
    const totalChanges = hunk.lines.filter(
      l => l.left.type === 'del' || l.right.type === 'add'
    ).length;
    const selection: PatchSelectionRequest = {
      filePath: panel.selectedFilePath,
      source: panel.selectedSource === 'branch' ? 'unstaged' : panel.selectedSource,
      chunks: [{ chunkIndex: hunkIndex, selectedChangeIndices: Array.from({ length: totalChanges }, (_, i) => i) }],
    };
    await api.stagePatch(currentSessionId, selection);
    structuredDiffRefetch();
    onRefresh();
  }, [panel.selectedFilePath, panel.selectedSource, structuredDiffData, currentSessionId, structuredDiffRefetch, onRefresh]);

  const handleDiscardHunk = useCallback(async (hunkIndex: number) => {
    if (!panel.selectedFilePath || !structuredDiffData) return;
    const hunk = structuredDiffData.hunks[hunkIndex];
    if (!hunk) return;
    const totalChanges = hunk.lines.filter(
      l => l.left.type === 'del' || l.right.type === 'add'
    ).length;
    const selection: PatchSelectionRequest = {
      filePath: panel.selectedFilePath,
      source: panel.selectedSource === 'branch' ? 'unstaged' : panel.selectedSource,
      chunks: [{ chunkIndex: hunkIndex, selectedChangeIndices: Array.from({ length: totalChanges }, (_, i) => i) }],
    };
    await api.discardPatch(currentSessionId, selection);
    structuredDiffRefetch();
    onRefresh();
  }, [panel.selectedFilePath, panel.selectedSource, structuredDiffData, currentSessionId, structuredDiffRefetch, onRefresh]);

  const handleUnstageHunk = useCallback(async (hunkIndex: number) => {
    if (!panel.selectedFilePath || !structuredDiffData) return;
    const hunk = structuredDiffData.hunks[hunkIndex];
    if (!hunk) return;
    const totalChanges = hunk.lines.filter(
      l => l.left.type === 'del' || l.right.type === 'add'
    ).length;
    const selection: PatchSelectionRequest = {
      filePath: panel.selectedFilePath,
      source: 'staged',
      chunks: [{ chunkIndex: hunkIndex, selectedChangeIndices: Array.from({ length: totalChanges }, (_, i) => i) }],
    };
    await api.discardPatch(currentSessionId, selection);
    structuredDiffRefetch();
    onRefresh();
  }, [panel.selectedFilePath, structuredDiffData, currentSessionId, structuredDiffRefetch, onRefresh]);

  const headerBtnStyle = {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '0 4px',
    lineHeight: 1,
  } as const;

  const inputStyle = {
    flex: 1,
    boxSizing: 'border-box' as const,
    fontSize: '12px',
    padding: '3px 8px',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: '4px',
    background: 'var(--color-bg-input)',
    color: 'var(--color-text-primary)',
    outline: 'none',
    fontFamily: 'var(--font-mono)',
  };

  // Branch row JSX (from original GitDiffPanel)
  const branchRow = branches.length > 0 || creatingBranch || showPullAndBranch ? (
    <div style={{ padding: '4px 8px 4px', flexShrink: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
        {!creatingBranch && !showPullAndBranch ? (
          <>
            <select
              value={currentBranch}
              onChange={e => handleBranchChange(e.target.value)}
              disabled={branchLoading}
              style={{
                ...inputStyle,
                minWidth: 0,
                cursor: branchLoading ? 'not-allowed' : 'pointer',
                opacity: branchLoading ? 0.6 : 1,
              }}
            >
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
              {currentBranch && !branches.includes(currentBranch) && (
                <option value={currentBranch}>{currentBranch}</option>
              )}
            </select>
            <button
              onClick={handlePull}
              disabled={branchLoading}
              title={behindCount ? `Pull (${behindCount} commit${behindCount !== 1 ? 's' : ''} behind)` : 'Pull'}
              style={{ ...headerBtnStyle, flexShrink: 0, position: 'relative' }}
            >
              ↓
              {!!behindCount && behindCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-2px',
                  right: '-1px',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--color-accent)',
                  pointerEvents: 'none',
                }} />
              )}
            </button>
            <button
              onClick={() => { setCreatingBranch(true); setNewBranchName(''); setBranchError(''); }}
              title="Create new branch"
              style={{ ...headerBtnStyle, flexShrink: 0 }}
            >+</button>
            <button
              onClick={() => {
                setShowPullAndBranch(true);
                setPullBranchName('');
                setPullBaseBranch(branches.find(b => b === 'main' || b === 'master') || currentBranch);
                setBranchError('');
              }}
              disabled={branchLoading}
              title="Pull latest & create branch"
              style={{ ...headerBtnStyle, flexShrink: 0, fontSize: '12px' }}
            >↓+</button>
          </>
        ) : showPullAndBranch ? (
          <>
            <input
              autoFocus
              value={pullBranchName}
              onChange={e => setPullBranchName(e.target.value)}
              placeholder="new-branch-name"
              disabled={branchLoading}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handlePullAndBranch(); }
                if (e.key === 'Escape') { setShowPullAndBranch(false); setBranchError(''); }
              }}
              style={{ ...inputStyle, minWidth: 0 }}
            />
            <select
              value={pullBaseBranch}
              onChange={e => setPullBaseBranch(e.target.value)}
              disabled={branchLoading}
              title="Base branch"
              style={{ ...inputStyle, maxWidth: '100px', flexShrink: 0 }}
            >
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <button onClick={handlePullAndBranch} disabled={branchLoading} title="Confirm" style={{ ...headerBtnStyle, flexShrink: 0 }}>✓</button>
            <button onClick={() => { setShowPullAndBranch(false); setBranchError(''); }} title="Cancel" style={{ ...headerBtnStyle, flexShrink: 0 }}>✕</button>
          </>
        ) : (
          <>
            <input
              autoFocus
              value={newBranchName}
              onChange={e => setNewBranchName(e.target.value)}
              placeholder="new-branch-name"
              disabled={branchLoading}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handleCreateBranch(); }
                if (e.key === 'Escape') { setCreatingBranch(false); setBranchError(''); }
              }}
              style={{ ...inputStyle, minWidth: 0 }}
            />
            <button onClick={handleCreateBranch} disabled={branchLoading} title="Confirm" style={{ ...headerBtnStyle, flexShrink: 0 }}>✓</button>
            <button onClick={() => { setCreatingBranch(false); setBranchError(''); }} title="Cancel" style={{ ...headerBtnStyle, flexShrink: 0 }}>✕</button>
          </>
        )}
      </div>
      {branchError && (
        <div style={{ fontSize: '11px', color: 'var(--color-error)', marginTop: '2px', padding: '0 2px' }}>
          {branchError}
        </div>
      )}
    </div>
  ) : null;

  // Diff viewer toolbar
  const diffViewerToolbar = (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '4px 8px',
      borderBottom: '1px solid var(--color-border-base)',
      flexShrink: 0,
      background: 'var(--color-bg-elevated)',
    }}>
      {/* View mode toggle */}
      <button
        onClick={panel.toggleViewMode}
        title={panel.effectiveViewMode === 'split' ? 'Switch to unified view' : 'Switch to split view'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: panel.effectiveViewMode === 'split' ? 'var(--color-accent-subtle)' : 'none',
          border: panel.effectiveViewMode === 'split' ? '1px solid var(--color-accent)' : '1px solid var(--color-border-subtle)',
          borderRadius: '4px',
          color: panel.effectiveViewMode === 'split' ? 'var(--color-accent)' : 'var(--color-text-muted)',
          cursor: 'pointer',
          fontSize: '11px',
          padding: '2px 6px',
          lineHeight: 1,
        }}
      >
        <SplitSquareHorizontal size={11} strokeWidth={1.75} />
        <span>Split</span>
      </button>
      <button
        onClick={panel.toggleViewMode}
        title={panel.effectiveViewMode === 'unified' ? 'Switch to split view' : 'Switch to unified view'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: panel.effectiveViewMode === 'unified' ? 'var(--color-accent-subtle)' : 'none',
          border: panel.effectiveViewMode === 'unified' ? '1px solid var(--color-accent)' : '1px solid var(--color-border-subtle)',
          borderRadius: '4px',
          color: panel.effectiveViewMode === 'unified' ? 'var(--color-accent)' : 'var(--color-text-muted)',
          cursor: 'pointer',
          fontSize: '11px',
          padding: '2px 6px',
          lineHeight: 1,
        }}
      >
        <AlignLeft size={11} strokeWidth={1.75} />
        <span>Unified</span>
      </button>

      {/* Blame toggle — only when source is 'branch' */}
      {panel.selectedSource === 'branch' && (
        <button
          onClick={panel.toggleBlame}
          title={panel.blameActive ? 'Hide blame' : 'Show blame'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            background: panel.blameActive ? 'var(--color-accent-subtle)' : 'none',
            border: panel.blameActive ? '1px solid var(--color-accent)' : '1px solid var(--color-border-subtle)',
            borderRadius: '4px',
            color: panel.blameActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: '11px',
            padding: '2px 6px',
            lineHeight: 1,
          }}
        >
          <Eye size={11} strokeWidth={1.75} />
          <span>Blame</span>
        </button>
      )}

      {/* Show untracked toggle */}
      <button
        onClick={panel.toggleShowUntracked}
        title={panel.showUntracked ? 'Hide untracked files' : 'Show untracked files'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: panel.showUntracked ? 'none' : 'var(--color-accent-subtle)',
          border: panel.showUntracked ? '1px solid var(--color-border-subtle)' : '1px solid var(--color-accent)',
          borderRadius: '4px',
          color: panel.showUntracked ? 'var(--color-text-muted)' : 'var(--color-accent)',
          cursor: 'pointer',
          fontSize: '11px',
          padding: '2px 6px',
          lineHeight: 1,
        }}
      >
        <EyeOff size={11} strokeWidth={1.75} />
        <span>Untracked</span>
      </button>

      <div style={{ flex: 1 }} />

      {/* Search toggle */}
      <button
        onClick={panel.searchActive ? panel.closeSearch : panel.openSearch}
        title={panel.searchActive ? 'Close search' : 'Search in diff'}
        style={{
          ...headerBtnStyle,
          color: panel.searchActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
        }}
      >
        <Search size={13} strokeWidth={1.75} />
      </button>
    </div>
  );

  // Search bar
  const searchBar = panel.searchActive ? (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 8px',
      borderBottom: '1px solid var(--color-border-base)',
      flexShrink: 0,
    }}>
      <input
        autoFocus
        type="text"
        value={panel.searchQuery}
        onChange={e => panel.setSearchQuery(e.target.value)}
        placeholder="Search in diff…"
        onKeyDown={e => {
          if (e.key === 'Escape') { e.stopPropagation(); panel.closeSearch(); }
        }}
        style={{
          flex: 1,
          boxSizing: 'border-box',
          fontSize: '12px',
          padding: '3px 8px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '4px',
          background: 'var(--color-bg-input)',
          color: 'var(--color-text-primary)',
          outline: 'none',
          fontFamily: 'var(--font-mono)',
        }}
      />
      <button
        onClick={panel.closeSearch}
        style={{ ...headerBtnStyle }}
        title="Close search"
      >
        <X size={13} strokeWidth={1.75} />
      </button>
    </div>
  ) : null;

  // Right-side diff viewer content
  const diffViewerContent = (() => {
    if (!panel.selectedFilePath) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          color: 'var(--color-text-muted)',
          fontSize: '13px',
          fontStyle: 'italic',
        }}>
          Select a file to view its diff
        </div>
      );
    }

    if (structuredDiffLoading && !structuredDiffData) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          color: 'var(--color-text-muted)',
          fontSize: '13px',
        }}>
          Loading…
        </div>
      );
    }

    if (structuredDiffError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          color: 'var(--color-text-muted)',
          gap: '8px',
        }}>
          <span style={{ fontSize: '13px' }}>{structuredDiffError}</span>
          <button
            onClick={structuredDiffRefetch}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: '4px',
              background: 'transparent',
              color: 'var(--color-accent)',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    if (!structuredDiffData || structuredDiffData.hunks.length === 0) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          color: 'var(--color-text-muted)',
          fontSize: '13px',
        }}>
          {structuredDiffData?.isBinary ? 'Binary file' : 'No changes — working tree is clean'}
        </div>
      );
    }

    const commonDiffProps = {
      hunks: structuredDiffData.hunks,
      section: panel.selectedSource,
      hiddenHunkIndices,
      searchQuery: panel.searchQuery || undefined,
      wordWrap,
      contextLines: panel.contextLines,
      onExpandContext: panel.expandContext,
      onStageHunk: panel.selectedSource === 'unstaged' ? handleStageHunk : undefined,
      onDiscardHunk: panel.selectedSource === 'unstaged' ? handleDiscardHunk : undefined,
      onUnstageHunk: panel.selectedSource === 'staged' ? handleUnstageHunk : undefined,
    };

    if (panel.effectiveViewMode === 'split') {
      return <SideBySideDiffPane {...commonDiffProps} />;
    }
    return <UnifiedDiffPane {...commonDiffProps} />;
  })();

  // File path breadcrumb shown above diff
  const diffFileHeader = panel.selectedFilePath ? (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '4px 12px',
      background: 'var(--color-bg-elevated)',
      borderBottom: '1px solid var(--color-border-base)',
      flexShrink: 0,
    }}>
      <span style={{
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-primary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {panel.selectedFilePath}
      </span>
      {onOpenInExplorer && folderPath && (
        <InlineIconLink
          icon={FolderOpen}
          label="Open in Explorer"
          onClick={() => onOpenInExplorer(`${folderPath.replace(/\/$/, '')}/${panel.selectedFilePath}`)}
        />
      )}
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        background: 'var(--color-bg-base)',
        borderLeft: isFullscreen ? 'none' : '1px solid var(--color-border-base)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'var(--color-bg-header)',
          borderBottom: '1px solid var(--color-border-base)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)', flexShrink: 0 }}>
              Git Diff
            </span>
            {!isEmpty && !error && (
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                {totalFiles} file{totalFiles !== 1 ? 's' : ''}
                {totalAdditions > 0 && <span style={{ color: 'var(--color-success)', marginLeft: '6px' }}>+{totalAdditions}</span>}
                {totalDeletions > 0 && <span style={{ color: 'var(--color-error)', marginLeft: '4px' }}>-{totalDeletions}</span>}
              </span>
            )}
          </div>
          {showSessionSelector && isNarrow && (
            <select
              className="diff-session-select"
              value={currentSessionId}
              onChange={e => onSelectSession(e.target.value)}
              style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-secondary)',
                background: 'var(--color-bg-input)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: '4px',
                padding: '1px 4px',
                cursor: 'pointer',
                maxWidth: '200px',
                outline: 'none',
              }}
            >
              {(sessions ?? []).map(s => (
                <option key={s.id} value={s.id}>
                  {s.hasGitChanges ? '⚠ ' : ''}{s.name} — {s.folderPath.split('/').slice(-2).join('/')}
                </option>
              ))}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {!isEmpty && !error && (
            <button
              onClick={() => setWordWrap(w => { const next = !w; localStorage.setItem('gitdiff-word-wrap', String(next)); return next; })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: wordWrap ? 'var(--color-accent-subtle)' : 'none',
                border: wordWrap ? '1px solid var(--color-accent)' : '1px solid transparent',
                borderRadius: '4px',
                color: wordWrap ? 'var(--color-accent)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: wordWrap ? 600 : 400,
                padding: '2px 6px',
                lineHeight: 1,
              }}
              title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            >
              <WrapText size={11} strokeWidth={2} />
              Wrap
            </button>
          )}
          {onToggleTerminal && (
            <button
              onClick={onToggleTerminal}
              title={showTerminal ? 'Close terminal' : 'Open terminal'}
              style={{
                background: showTerminal ? 'var(--color-accent)' : 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px',
                display: 'inline-flex',
                borderRadius: 'var(--radius-sm)',
                color: showTerminal ? '#fff' : 'var(--color-text-muted)',
                transition: 'color var(--transition-fast)',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { if (!showTerminal) e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { if (!showTerminal) e.currentTarget.style.color = 'var(--color-text-muted)'; }}
            >
              <TerminalIcon size={13} strokeWidth={1.75} />
            </button>
          )}
          {showHeaderControls && (
            <>
              <button onClick={onToggleFullscreen} style={headerBtnStyle} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                {isFullscreen ? '⤣' : '⤢'}
              </button>
              <button onClick={onClose} style={headerBtnStyle} title="Close diff">
                {'✕'}
              </button>
            </>
          )}
        </div>
      </div>

      {isNarrow ? (
        /* Narrow layout: simplified accordion-based view */
        <>
          {isElectron ? (
            <MacDiffToolbar
              branches={branches}
              currentBranch={currentBranch}
              onBranchChange={handleBranchChange}
              branchLoading={branchLoading}
              behindCount={behindCount}
              onPull={branches.length > 0 ? handlePull : undefined}
              onOpenBranchSheet={branches.length > 0 ? () => setShowBranchSheet(true) : undefined}
              searchQuery={panel.searchQuery}
              onSearchChange={panel.setSearchQuery}
              wordWrap={wordWrap}
              onToggleWordWrap={() => setWordWrap(w => { const next = !w; localStorage.setItem('gitdiff-word-wrap', String(next)); return next; })}
              isLoading={isLoading}
              onRefresh={onRefresh}
            />
          ) : (
            <>
              {branchRow}
              <div style={{ padding: '4px 8px 6px', borderBottom: '1px solid var(--color-border-base)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input
                  className="diff-search-input"
                  type="text"
                  placeholder="Search files and content…"
                  value={panel.searchQuery}
                  onChange={e => panel.setSearchQuery(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      if (panel.searchQuery) panel.setSearchQuery('');
                      else (e.target as HTMLInputElement).blur();
                    }
                  }}
                  style={{
                    flex: 1,
                    boxSizing: 'border-box',
                    fontSize: '12px',
                    padding: '3px 8px',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: '4px',
                    background: 'var(--color-bg-input)',
                    color: 'var(--color-text-primary)',
                    outline: 'none',
                  }}
                />
                <button onClick={onRefresh} style={{ ...headerBtnStyle, opacity: isLoading ? 0.5 : 1, flexShrink: 0 }} title="Refresh diff">
                  {'↻'}
                </button>
              </div>
            </>
          )}
          <div style={{ flex: 1, overflow: 'auto', padding: '8px', minHeight: 0 }}>
            {error && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>{error}</span>
                <button onClick={onRefresh} style={{ padding: '6px 14px', fontSize: '12px', border: '1px solid var(--color-border-subtle)', borderRadius: '6px', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                  Retry
                </button>
              </div>
            )}
            {!error && isEmpty && (diff !== null || !isLoading) && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: '14px' }}>
                No changes
              </div>
            )}
            {!error && isEmpty && isLoading && diff === null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: '14px' }}>
                Loading...
              </div>
            )}
            {!error && changedFilePaths.length > 0 && (
              <ChangelistFileList
                changelists={changelists.state}
                activeId={changelists.state.activeId}
                changedFilePaths={changedFilePaths}
                stagedFilePaths={stagedFilePaths}
                unstagedOnlyFilePaths={unstagedOnlyFilePaths}
                gitStatuses={gitStatuses}
                selectedFilePath={panel.selectedFilePath}
                onSelectFile={(filePath, source) => {
                  panel.setSelectedFilePath(filePath);
                  panel.setSelectedSource(source);
                }}
                onSetActive={changelists.setActiveChangelist}
                onMoveFile={changelists.moveFileToChangelist}
                showUntracked={panel.showUntracked}
              />
            )}
          </div>
        </>
      ) : (
        /* Wide layout: session sidebar | file list | content */
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
          {/* Session sidebar (resizable) */}
          {showSessionSelector && (
            <>
              <SessionSidebar
                sessions={sessions ?? []}
                activeSessionId={currentSessionId}
                onSelectSession={onSelectSession}
                width={sidebarWidth}
              />
              <ResizeDivider isDragging={isSidebarDragging} onMouseDown={handleSidebarMouseDown} />
            </>
          )}

          {/* File list sidebar (resizable) */}
          <div ref={fileListRef} style={{ width: `${fileListWidth}px`, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-surface)', overflow: 'hidden' }}>
            {isElectron ? (
              <MacDiffToolbar
                branches={branches}
                currentBranch={currentBranch}
                onBranchChange={handleBranchChange}
                branchLoading={branchLoading}
                behindCount={behindCount}
                onPull={branches.length > 0 ? handlePull : undefined}
                onOpenBranchSheet={branches.length > 0 ? () => setShowBranchSheet(true) : undefined}
                searchQuery={panel.searchQuery}
                onSearchChange={panel.setSearchQuery}
                wordWrap={wordWrap}
                onToggleWordWrap={() => setWordWrap(w => { const next = !w; localStorage.setItem('gitdiff-word-wrap', String(next)); return next; })}
                isLoading={isLoading}
                onRefresh={onRefresh}
              />
            ) : (
              <>
                {branchRow}
                <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border-base)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    className="diff-search-input"
                    type="text"
                    placeholder="Search files…"
                    value={panel.searchQuery}
                    onChange={e => panel.setSearchQuery(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        if (panel.searchQuery) panel.setSearchQuery('');
                        else (e.target as HTMLInputElement).blur();
                      }
                    }}
                    style={{ flex: 1, boxSizing: 'border-box', fontSize: '12px', padding: '3px 8px', border: '1px solid var(--color-border-subtle)', borderRadius: '4px', background: 'var(--color-bg-input)', color: 'var(--color-text-primary)', outline: 'none' }}
                  />
                  <button onClick={onRefresh} style={{ ...headerBtnStyle, opacity: isLoading ? 0.5 : 1, flexShrink: 0 }} title="Refresh diff">
                    {'↻'}
                  </button>
                </div>
              </>
            )}

            {/* File list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {(error || (isEmpty && (diff !== null || !isLoading))) && (
                <div style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                  {error ? 'Error loading' : 'No changes'}
                </div>
              )}
              {isEmpty && isLoading && diff === null && (
                <div style={{ padding: '12px', fontSize: '12px', color: 'var(--color-text-muted)', textAlign: 'center' }}>Loading...</div>
              )}
              {!error && changedFilePaths.length > 0 && (
                <ChangelistFileList
                  changelists={changelists.state}
                  activeId={changelists.state.activeId}
                  changedFilePaths={changedFilePaths}
                  stagedFilePaths={stagedFilePaths}
                  unstagedOnlyFilePaths={unstagedOnlyFilePaths}
                  gitStatuses={gitStatuses}
                  selectedFilePath={panel.selectedFilePath}
                  onSelectFile={(filePath, source) => {
                    panel.setSelectedFilePath(filePath);
                    panel.setSelectedSource(source);
                  }}
                  onSetActive={changelists.setActiveChangelist}
                  onMoveFile={changelists.moveFileToChangelist}
                  showUntracked={panel.showUntracked}
                />
              )}
            </div>
          </div>

          <ResizeDivider isDragging={isFileListDragging} onMouseDown={handleFileListMouseDown} />

          {/* Right content: diff viewer */}
          <div
            ref={panel.panelRef}
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            {/* Global error/empty states */}
            {error && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>{error}</span>
                <button onClick={onRefresh} style={{ padding: '6px 14px', fontSize: '12px', border: '1px solid var(--color-border-subtle)', borderRadius: '6px', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>Retry</button>
              </div>
            )}
            {!error && isEmpty && (diff !== null || !isLoading) && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: '14px' }}>No changes — working tree is clean</div>
            )}
            {!error && isEmpty && isLoading && diff === null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: '14px' }}>Loading...</div>
            )}

            {/* Diff viewer (file header + toolbar + search + content) */}
            {!error && !isEmpty && (
              <>
                {diffFileHeader}
                {diffViewerToolbar}
                {searchBar}
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {diffViewerContent}
                </div>
              </>
            )}

            {/* CommitBar at the bottom of the right content pane */}
            {!isMobile && activeChangelist && (
              <CommitBar
                sessionId={currentSessionId}
                activeChangelist={activeChangelist}
                stagedFilesInList={stagedFilesInActiveList}
                onCommitSuccess={() => { onRefresh(); }}
              />
            )}
          </div>
        </div>
      )}

      {/* Mobile FAB — opens bottom sheet */}
      {isMobile && (
        <button className="commit-fab" onClick={() => setSheetOpen(true)} aria-label="Open commit panel">
          <GitCommit size={22} strokeWidth={2} />
        </button>
      )}

      {/* Mobile bottom sheet */}
      {isMobile && sheetOpen && activeChangelist && (
        <>
          <div className="commit-sheet-backdrop" onClick={() => setSheetOpen(false)} />
          <div
            className="commit-sheet"
            onTouchStart={(e) => { touchStartRef.current = e.touches[0].clientY; }}
            onTouchEnd={(e) => {
              if (e.changedTouches[0].clientY - touchStartRef.current > 60) setSheetOpen(false);
            }}
          >
            <div className="commit-sheet-handle" />
            <CommitBar
              sessionId={currentSessionId}
              activeChangelist={activeChangelist}
              stagedFilesInList={stagedFilesInActiveList}
              onCommitSuccess={() => { setSheetOpen(false); onRefresh(); }}
            />
          </div>
        </>
      )}

      {/* macOS branch management sheet */}
      {isElectron && (
        <MacDiffBranchSheet
          isOpen={showBranchSheet}
          onClose={() => setShowBranchSheet(false)}
          branches={branches}
          currentBranch={currentBranch}
          onCreateBranch={createBranchDirect}
          onPullAndBranch={pullAndBranchDirect}
          branchLoading={branchLoading}
          branchError={branchError}
        />
      )}
    </div>
  );
}
