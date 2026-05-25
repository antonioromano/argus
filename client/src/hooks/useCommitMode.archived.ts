import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { api } from '../services/api.js';
import type { PatchSelectionRequest } from '@argus/shared';

// Tri-state for a file or hunk checkbox
export type TriState = 'none' | 'partial' | 'all';

// Per-hunk: which change indices (0-based, add/del only) are selected
export type HunkSelections = Map<number, Set<number>>;

// Per-file: map of chunkIndex → selected change indices
export type FileSelection = Map<number, Set<number>>;

// Map of filePath → FileSelection
export type SelectionMap = Map<string, FileSelection>;

// Metadata about a file's hunks, needed for tri-state computation
export interface HunkMeta {
  chunkIndex: number;
  totalChanges: number; // count of add/del lines in this hunk
}

export interface FileMeta {
  filePath: string;
  hunks: HunkMeta[];
  isUntracked?: boolean;
  isBinary?: boolean;
  isRenamed?: boolean;
}

interface UndoEntry {
  id: string;
  description: string;
}

interface CommitModeState {
  isActive: boolean;
  selections: SelectionMap;
  status: 'idle' | 'staging' | 'committing' | 'error';
  errorMessage: string | null;
  commitMessage: string;
  isAmend: boolean;
  lastCommitMessage: string;
  isFirstCommit: boolean;
  undoEntry: UndoEntry | null;
  // Stale diff warning: set when diff refreshes while commit mode is active
  hasStaleDiff: boolean;
}

export interface CommitModeActions {
  toggleCommitMode: () => void;
  loadGitInfo: (sessionId: string) => Promise<void>;
  toggleLine: (filePath: string, chunkIndex: number, changeIndex: number) => void;
  toggleChunk: (filePath: string, chunkIndex: number, totalChanges: number) => void;
  toggleFile: (filePath: string, fileMeta: FileMeta) => void;
  selectAll: (fileMetas: FileMeta[]) => void;
  clearAll: () => void;
  clearFileSelections: (filePath: string) => void;
  setCommitMessage: (msg: string) => void;
  setIsAmend: (amend: boolean) => void;
  stageAndCommit: (sessionId: string, fileMetas: FileMeta[], untrackedFiles: string[]) => Promise<boolean>;
  stageCommitAndPush: (sessionId: string, fileMetas: FileMeta[], untrackedFiles: string[]) => Promise<boolean>;
  discardSelected: (sessionId: string, fileMetas: FileMeta[]) => Promise<void>;
  discardLine: (sessionId: string, filePath: string, chunkIndex: number, changeIndex: number) => Promise<void>;
  discardChunk: (sessionId: string, filePath: string, chunkIndex: number, totalChanges: number) => Promise<void>;
  undoDiscard: (sessionId: string) => Promise<void>;
  dismissUndoEntry: () => void;
  dismissError: () => void;
  notifyDiffRefreshed: () => void;
  dismissStaleDiff: () => void;
}

export interface UseCommitModeResult {
  commitMode: CommitModeState;
  actions: CommitModeActions;
  // Derived
  selectedLineCount: number;
  selectedFileCount: number;
  canCommit: boolean;
}

export function fileTriState(fileSelection: FileSelection | undefined, fileMeta: FileMeta): TriState {
  if (!fileSelection || fileSelection.size === 0) return 'none';
  // Untracked files use a sentinel Map([[0, Set([0])]]) — presence in map means selected
  if (fileMeta.isUntracked) return 'all';
  let totalSelected = 0;
  let totalPossible = 0;
  for (const hunk of fileMeta.hunks) {
    totalPossible += hunk.totalChanges;
    totalSelected += fileSelection.get(hunk.chunkIndex)?.size ?? 0;
  }
  if (totalSelected === 0) return 'none';
  if (totalSelected >= totalPossible) return 'all';
  return 'partial';
}

export function chunkTriState(chunkSel: Set<number> | undefined, totalChanges: number): TriState {
  if (!chunkSel || chunkSel.size === 0) return 'none';
  if (chunkSel.size >= totalChanges) return 'all';
  return 'partial';
}

export function useCommitMode(): UseCommitModeResult {
  const [state, setState] = useState<CommitModeState>({
    isActive: true,
    selections: new Map(),
    status: 'idle',
    errorMessage: null,
    commitMessage: '',
    isAmend: false,
    lastCommitMessage: '',
    isFirstCommit: false,
    undoEntry: null,
    hasStaleDiff: false,
  });

  // Always-current state ref to avoid stale closures in async operations
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const toggleCommitMode = useCallback(() => {
    setState(prev => {
      if (prev.isActive) {
        // Exit: clear everything
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        return {
          ...prev,
          isActive: false,
          selections: new Map(),
          status: 'idle',
          errorMessage: null,
          commitMessage: '',
          isAmend: false,
          undoEntry: null,
          hasStaleDiff: false,
        };
      }
      return { ...prev, isActive: true };
    });
  }, []);

  const toggleLine = useCallback((filePath: string, chunkIndex: number, changeIndex: number) => {
    setState(prev => {
      const newSelections = new Map(prev.selections);
      const fileSelection = new Map(newSelections.get(filePath) ?? []);
      const chunkSel = new Set(fileSelection.get(chunkIndex) ?? []);

      if (chunkSel.has(changeIndex)) {
        chunkSel.delete(changeIndex);
      } else {
        chunkSel.add(changeIndex);
      }

      if (chunkSel.size === 0) {
        fileSelection.delete(chunkIndex);
      } else {
        fileSelection.set(chunkIndex, chunkSel);
      }

      if (fileSelection.size === 0) {
        newSelections.delete(filePath);
      } else {
        newSelections.set(filePath, fileSelection);
      }

      return { ...prev, selections: newSelections };
    });
  }, []);

  const toggleChunk = useCallback((filePath: string, chunkIndex: number, totalChanges: number) => {
    setState(prev => {
      const newSelections = new Map(prev.selections);
      const fileSelection = new Map(newSelections.get(filePath) ?? []);
      const existing = fileSelection.get(chunkIndex);
      const isAll = existing && existing.size >= totalChanges;

      if (isAll) {
        // All selected → deselect all
        fileSelection.delete(chunkIndex);
      } else {
        // Partial or none → select all
        const allIndices = new Set<number>();
        for (let i = 0; i < totalChanges; i++) allIndices.add(i);
        fileSelection.set(chunkIndex, allIndices);
      }

      if (fileSelection.size === 0) {
        newSelections.delete(filePath);
      } else {
        newSelections.set(filePath, fileSelection);
      }

      return { ...prev, selections: newSelections };
    });
  }, []);

  const toggleFile = useCallback((filePath: string, fileMeta: FileMeta) => {
    setState(prev => {
      const newSelections = new Map(prev.selections);
      const currentState = fileTriState(newSelections.get(filePath), fileMeta);

      if (currentState === 'all') {
        newSelections.delete(filePath);
      } else if (fileMeta.isUntracked) {
        // Sentinel: Map([[0, Set([0])]]) marks untracked file as "selected"
        newSelections.set(filePath, new Map([[0, new Set([0])]]));
      } else {
        const fileSelection = new Map<number, Set<number>>();
        for (const hunk of fileMeta.hunks) {
          const allIndices = new Set<number>();
          for (let i = 0; i < hunk.totalChanges; i++) allIndices.add(i);
          if (allIndices.size > 0) fileSelection.set(hunk.chunkIndex, allIndices);
        }
        newSelections.set(filePath, fileSelection);
      }

      return { ...prev, selections: newSelections };
    });
  }, []);

  const selectAll = useCallback((fileMetas: FileMeta[]) => {
    setState(prev => {
      const newSelections = new Map<string, FileSelection>();
      for (const meta of fileMetas) {
        if (meta.isBinary || meta.isRenamed) continue;
        if (meta.isUntracked) {
          // Sentinel for untracked files
          newSelections.set(meta.filePath, new Map([[0, new Set([0])]]));
          continue;
        }
        const fileSelection = new Map<number, Set<number>>();
        for (const hunk of meta.hunks) {
          if (hunk.totalChanges === 0) continue;
          const allIndices = new Set<number>();
          for (let i = 0; i < hunk.totalChanges; i++) allIndices.add(i);
          fileSelection.set(hunk.chunkIndex, allIndices);
        }
        if (fileSelection.size > 0) newSelections.set(meta.filePath, fileSelection);
      }
      return { ...prev, selections: newSelections };
    });
  }, []);

  const clearAll = useCallback(() => {
    setState(prev => ({ ...prev, selections: new Map() }));
  }, []);

  const clearFileSelections = useCallback((filePath: string) => {
    setState(prev => {
      if (!prev.selections.has(filePath)) return prev;
      const newSelections = new Map(prev.selections);
      newSelections.delete(filePath);
      return { ...prev, selections: newSelections };
    });
  }, []);

  const setCommitMessage = useCallback((msg: string) => {
    setState(prev => ({ ...prev, commitMessage: msg }));
  }, []);

  const setIsAmend = useCallback((amend: boolean) => {
    setState(prev => ({ ...prev, isAmend: amend }));
  }, []);

  const dismissError = useCallback(() => {
    setState(prev => ({ ...prev, errorMessage: null }));
  }, []);

  const notifyDiffRefreshed = useCallback(() => {
    setState(prev => {
      if (!prev.isActive || prev.selections.size === 0) return prev;
      if (prev.status !== 'idle') return prev; // don't flag stale during commit/staging
      return { ...prev, hasStaleDiff: true };
    });
  }, []);

  const dismissStaleDiff = useCallback(() => {
    setState(prev => ({ ...prev, hasStaleDiff: false }));
  }, []);

  const dismissUndoEntry = useCallback(() => {
    setState(prev => ({ ...prev, undoEntry: null }));
  }, []);

  const loadGitInfo = useCallback(async (sessionId: string) => {
    try {
      const logInfo = await api.getGitLog(sessionId);
      setState(prev => ({
        ...prev,
        isFirstCommit: logInfo.isFirstCommit,
        lastCommitMessage: logInfo.lastMessage,
      }));
    } catch {
      // ignore — commit mode still works without git log info
    }
  }, []);

  // Build PatchSelectionRequest array from current selections
  function buildSelections(fileMetas: FileMeta[], selections: SelectionMap): PatchSelectionRequest[] {
    const result: PatchSelectionRequest[] = [];
    for (const meta of fileMetas) {
      if (meta.isUntracked || meta.isBinary || meta.isRenamed) continue;
      const fileSelection = selections.get(meta.filePath);
      if (!fileSelection || fileSelection.size === 0) continue;

      const chunks = [];
      for (const [chunkIndex, selectedSet] of fileSelection) {
        if (selectedSet.size === 0) continue;
        chunks.push({ chunkIndex, selectedChangeIndices: Array.from(selectedSet).sort((a, b) => a - b) });
      }
      if (chunks.length === 0) continue;

      result.push({
        filePath: meta.filePath,
        fromPath: meta.isRenamed ? undefined : undefined,
        source: 'unstaged',
        chunks,
      });
    }
    return result;
  }

  const stageAndCommit = useCallback(async (
    sessionId: string,
    fileMetas: FileMeta[],
    untrackedFiles: string[],
    shouldPush = false,
  ): Promise<boolean> => {
    setState(prev => ({ ...prev, status: 'staging', errorMessage: null }));

    const { selections, commitMessage, isAmend } = stateRef.current;

    // Stage selected patches
    const patchSelections = buildSelections(fileMetas, selections);

    for (const selection of patchSelections) {
      const result = await api.stagePatch(sessionId, selection);
      if (!result.success) {
        setState(prev => ({ ...prev, status: 'error', errorMessage: result.error ?? 'Stage failed' }));
        return false;
      }
    }

    // Stage selected untracked files
    const selectedUntracked = untrackedFiles.filter(f => {
      const fs = selections.get(f);
      return fs && fs.size > 0;
    });
    for (const filePath of selectedUntracked) {
      const result = await api.stagePatch(sessionId, { filePath, source: 'unstaged', chunks: [] });
      if (!result.success) {
        setState(prev => ({ ...prev, status: 'error', errorMessage: result.error ?? 'Stage file failed' }));
        return false;
      }
    }

    setState(prev => ({ ...prev, status: 'committing' }));

    const commitResult = await api.gitCommit(sessionId, { message: commitMessage, amend: isAmend });
    if (!commitResult.success) {
      setState(prev => ({ ...prev, status: 'error', errorMessage: commitResult.error ?? 'Commit failed' }));
      return false;
    }

    if (shouldPush) {
      setState(prev => ({ ...prev, status: 'committing' }));
      const pushResult = await api.gitPush(sessionId);
      if (!pushResult.success) {
        setState(prev => ({ ...prev, status: 'error', errorMessage: pushResult.error ?? 'Push failed' }));
        return false;
      }
    }

    // Success: keep commit mode active for iterative workflow
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setState(prev => ({
      ...prev,
      isActive: true,
      selections: new Map(),
      status: 'idle',
      errorMessage: null,
      commitMessage: '',
      isAmend: false,
      undoEntry: null,
      hasStaleDiff: false,
    }));

    // Refresh git info (fire-and-forget) so Amend prefill shows the correct message
    loadGitInfo(sessionId);

    return true;
  }, [loadGitInfo]);

  const stageCommitAndPush = useCallback(async (
    sessionId: string,
    fileMetas: FileMeta[],
    untrackedFiles: string[],
  ) => {
    return stageAndCommit(sessionId, fileMetas, untrackedFiles, true);
  }, [stageAndCommit]);

  const discardSelected = useCallback(async (sessionId: string, fileMetas: FileMeta[]) => {
    const { selections } = stateRef.current;
    setState(prev => ({ ...prev, status: 'staging', errorMessage: null }));

    const patchSelections = buildSelections(fileMetas, selections);
    if (patchSelections.length === 0) {
      setState(prev => ({ ...prev, status: 'idle' }));
      return;
    }

    // Only discard the first selection for now (per-file undo entries could be added later)
    // For simplicity: discard each file's patch, store the last undoId
    let lastUndoId: string | undefined;
    let discardedCount = 0;

    for (const selection of patchSelections) {
      const result = await api.discardPatch(sessionId, selection);
      if (!result.success) {
        setState(prev => ({ ...prev, status: 'error', errorMessage: result.error ?? 'Discard failed' }));
        return;
      }
      lastUndoId = result.undoId;
      discardedCount++;
    }

    // Clear selections for discarded files
    setState(prev => {
      const newSelections = new Map(prev.selections);
      for (const sel of patchSelections) newSelections.delete(sel.filePath);
      return {
        ...prev,
        status: 'idle',
        selections: newSelections,
        undoEntry: lastUndoId ? { id: lastUndoId, description: `${discardedCount} file(s) discarded` } : null,
      };
    });

    // Auto-dismiss undo entry after 30s (matches server TTL)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    if (lastUndoId) {
      undoTimerRef.current = setTimeout(() => {
        setState(prev => ({ ...prev, undoEntry: null }));
      }, 30_000);
    }
  }, []);

  const discardLine = useCallback(async (sessionId: string, filePath: string, chunkIndex: number, changeIndex: number) => {
    // Guard against concurrent operations
    setState(prev => {
      if (prev.status !== 'idle') return prev;
      return { ...prev, errorMessage: null };
    });

    // Read current status synchronously via a ref to avoid stale closure
    const selection = {
      filePath,
      source: 'unstaged' as const,
      chunks: [{ chunkIndex, selectedChangeIndices: [changeIndex] }],
    };

    const result = await api.discardPatch(sessionId, selection);
    if (!result.success) {
      setState(prev => ({ ...prev, errorMessage: result.error ?? 'Revert line failed' }));
      return;
    }

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setState(prev => ({
      ...prev,
      undoEntry: result.undoId ? { id: result.undoId, description: '1 line reverted' } : null,
    }));
    if (result.undoId) {
      undoTimerRef.current = setTimeout(() => {
        setState(prev => ({ ...prev, undoEntry: null }));
      }, 30_000);
    }
  }, []);

  const discardChunk = useCallback(async (sessionId: string, filePath: string, chunkIndex: number, totalChanges: number) => {
    setState(prev => {
      if (prev.status !== 'idle') return prev;
      return { ...prev, errorMessage: null };
    });

    const allIndices = Array.from({ length: totalChanges }, (_, i) => i);
    const selection = {
      filePath,
      source: 'unstaged' as const,
      chunks: [{ chunkIndex, selectedChangeIndices: allIndices }],
    };

    const result = await api.discardPatch(sessionId, selection);
    if (!result.success) {
      setState(prev => ({ ...prev, errorMessage: result.error ?? 'Revert hunk failed' }));
      return;
    }

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setState(prev => ({
      ...prev,
      undoEntry: result.undoId ? { id: result.undoId, description: '1 hunk reverted' } : null,
    }));
    if (result.undoId) {
      undoTimerRef.current = setTimeout(() => {
        setState(prev => ({ ...prev, undoEntry: null }));
      }, 30_000);
    }
  }, []);

  const undoDiscard = useCallback(async (sessionId: string) => {
    const { undoEntry } = stateRef.current;
    if (!undoEntry) return;

    const result = await api.undoDiscard(sessionId, undoEntry.id);
    if (!result.success) {
      setState(prev => ({ ...prev, errorMessage: result.error ?? 'Undo failed' }));
      return;
    }

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setState(prev => ({ ...prev, undoEntry: null }));
  }, []);

  // Derived values — memoized to avoid re-iteration on non-selection state changes
  const { selectedLineCount, selectedFileCount } = useMemo(() => {
    let lineCount = 0;
    let fileCount = 0;
    for (const [, fileSelection] of state.selections) {
      let fileLines = 0;
      for (const [, chunkSel] of fileSelection) fileLines += chunkSel.size;
      if (fileLines > 0) {
        lineCount += fileLines;
        fileCount++;
      }
    }
    return { selectedLineCount: lineCount, selectedFileCount: fileCount };
  }, [state.selections]);

  const canCommit =
    (selectedLineCount > 0 || state.selections.size > 0) &&
    state.commitMessage.trim().length > 0 &&
    state.status === 'idle';

  return {
    commitMode: state,
    actions: {
      toggleCommitMode,
      loadGitInfo,
      toggleLine,
      toggleChunk,
      toggleFile,
      selectAll,
      clearAll,
      clearFileSelections,
      setCommitMessage,
      setIsAmend,
      stageAndCommit,
      stageCommitAndPush,
      discardSelected,
      discardLine,
      discardChunk,
      undoDiscard,
      dismissUndoEntry,
      dismissError,
      notifyDiffRefreshed,
      dismissStaleDiff,
    },
    selectedLineCount,
    selectedFileCount,
    canCommit,
  };
}
