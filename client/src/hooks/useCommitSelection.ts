import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommitSelectionFile, CommitSelectionState } from '@argus/shared';
import { api } from '../services/api.js';

const SAVE_DEBOUNCE_MS = 300;

interface UseCommitSelectionOptions {
  sessionId: string;
  isOpen: boolean;
}

export interface UseCommitSelectionResult {
  state: CommitSelectionState;
  isChecked: (filePath: string, hash: string) => boolean;
  toggle: (filePath: string, hash: string, source?: 'unstaged', fromPath?: string) => void;
  setBlocksForFile: (filePath: string, hashes: string[], source?: 'unstaged', fromPath?: string) => void;
  clearForFiles: (filePaths: string[]) => void;
  gcStale: (validHashesByFile: Map<string, ReadonlySet<string>>) => void;
  checkedHashesByFile: Map<string, Set<string>>;
  totalChecked: number;
}

const EMPTY_STATE: CommitSelectionState = { version: 1, files: [] };

export function useCommitSelection({ sessionId, isOpen }: UseCommitSelectionOptions): UseCommitSelectionResult {
  const [state, setState] = useState<CommitSelectionState>(EMPTY_STATE);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load on overlay open.
  useEffect(() => {
    if (!isOpen || !sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await api.getCommitSelection(sessionId);
        if (!cancelled && loaded?.version === 1 && Array.isArray(loaded.files)) {
          setState(loaded);
        }
      } catch {
        // Silent — overlay still works with empty state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, isOpen]);

  const queueSave = useCallback(() => {
    if (!sessionId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const snapshot = stateRef.current;
      void api.saveCommitSelection(sessionId, snapshot).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }, [sessionId]);

  // Flush on unmount / overlay close.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        api.saveCommitSelection(sessionId, stateRef.current).catch(() => {});
      }
    };
  }, [sessionId]);

  const checkedHashesByFile = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const f of state.files) m.set(f.filePath, new Set(f.blocks.map((b) => b.hash)));
    return m;
  }, [state]);

  const totalChecked = useMemo(
    () => state.files.reduce((acc, f) => acc + f.blocks.length, 0),
    [state],
  );

  const isChecked = useCallback(
    (filePath: string, hash: string) => {
      return checkedHashesByFile.get(filePath)?.has(hash) ?? false;
    },
    [checkedHashesByFile],
  );

  const toggle = useCallback(
    (filePath: string, hash: string, source: 'unstaged' = 'unstaged', fromPath?: string) => {
      setState((prev) => {
        const files = prev.files.slice();
        const idx = files.findIndex((f) => f.filePath === filePath);
        if (idx === -1) {
          files.push({ filePath, source, fromPath, blocks: [{ hash }] });
        } else {
          const f = files[idx];
          const has = f.blocks.some((b) => b.hash === hash);
          const newBlocks = has ? f.blocks.filter((b) => b.hash !== hash) : [...f.blocks, { hash }];
          if (newBlocks.length === 0) {
            files.splice(idx, 1);
          } else {
            files[idx] = { ...f, blocks: newBlocks };
          }
        }
        return { ...prev, files };
      });
      queueSave();
    },
    [queueSave],
  );

  const setBlocksForFile = useCallback(
    (filePath: string, hashes: string[], source: 'unstaged' = 'unstaged', fromPath?: string) => {
      setState((prev) => {
        const files = prev.files.filter((f) => f.filePath !== filePath);
        if (hashes.length > 0) {
          files.push({ filePath, source, fromPath, blocks: hashes.map((h) => ({ hash: h })) });
        }
        return { ...prev, files };
      });
      queueSave();
    },
    [queueSave],
  );

  const clearForFiles = useCallback(
    (filePaths: string[]) => {
      if (filePaths.length === 0) return;
      const set = new Set(filePaths);
      setState((prev) => ({ ...prev, files: prev.files.filter((f) => !set.has(f.filePath)) }));
      queueSave();
    },
    [queueSave],
  );

  const gcStale = useCallback(
    (validHashesByFile: Map<string, ReadonlySet<string>>) => {
      setState((prev) => {
        let dirty = false;
        const files: CommitSelectionFile[] = [];
        for (const f of prev.files) {
          const valid = validHashesByFile.get(f.filePath);
          if (!valid) {
            dirty = true;
            continue;
          }
          const kept = f.blocks.filter((b) => valid.has(b.hash));
          if (kept.length === f.blocks.length) {
            files.push(f);
          } else {
            dirty = true;
            if (kept.length > 0) files.push({ ...f, blocks: kept });
          }
        }
        if (!dirty) return prev;
        return { ...prev, files };
      });
      queueSave();
    },
    [queueSave],
  );

  return {
    state,
    isChecked,
    toggle,
    setBlocksForFile,
    clearForFiles,
    gcStale,
    checkedHashesByFile,
    totalChecked,
  };
}
