import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DirectoryEntry } from '@argus/shared';
import { api } from '../services/api.js';
import { toastError } from '../errors/toastError.js';
import { offerUndo, UNDO_WINDOW_LONG_MS } from '../utils/undoable.js';
import { useSocket } from './useSocket.js';

interface NodeState {
  entry: DirectoryEntry;
  children?: string[];
  expanded: boolean;
  loading: boolean;
  /** The last children fetch for this folder failed. Cleared by the next success. */
  error?: boolean;
}

/** Sentinel path for the synthetic "new file/folder" row while it is being named. */
export const DRAFT_PATH = '\0argus-draft';

/** `error`: why the last submit failed. Shown under the still-open input, so
 *  the name can be fixed in place (docs/design/feedback-surfaces.md, V6). */
export type TreeEdit =
  | { kind: 'create'; parentPath: string; isDir: boolean; error?: string }
  | { kind: 'rename'; path: string; currentName: string; error?: string };

export interface VisibleNode {
  path: string;
  depth: number;
  entry: DirectoryEntry;
  expanded: boolean;
  loading: boolean;
  /** The folder's children could not be fetched (click to retry). */
  error?: boolean;
  draft?: boolean;
}

/** `needs-permanent`: the item is on another volume, so it can't go to the
 *  staged trash; confirm, then call again with `permanent`. */
export type RemoveResult = 'deleted' | 'needs-permanent' | 'failed';

export interface UseFileTreeResult {
  rootPath: string;
  visibleNodes: VisibleNode[];
  toggle: (path: string) => void;
  refresh: () => void;
  isLoading: boolean;
  /** The last root listing failed (rendered inline by the explorer, never toasted). */
  rootError: unknown;
  /** The root's children have loaded at least once (so a root error is "stale", not "empty"). */
  rootLoaded: boolean;
  edit: TreeEdit | null;
  beginCreate: (parentPath: string, isDir: boolean) => void;
  beginRename: (path: string, currentName: string) => void;
  cancelEdit: () => void;
  submitEdit: (name: string) => Promise<boolean>;
  removePath: (path: string, isDir: boolean, opts?: { permanent?: boolean }) => Promise<RemoveResult>;
}

/**
 * Process-lifetime cache of node maps, keyed by session+root. Lets every
 * useFileTree instance for the same tree (side panel, explorer modal, reopen)
 * share expanded folders + already-fetched children, instead of each mount
 * reseeding to a collapsed root.
 */
const treeCache = new Map<string, Map<string, NodeState>>();
const cacheKey = (sessionId: string, rootPath: string) => `${sessionId}::${rootPath}`;

/**
 * Drop cached trees for sessions that no longer exist. The cache is
 * process-lifetime, so without this every closed session's expanded tree (and
 * all its fetched entries) stayed resident for the life of the window.
 * `cache` is injectable for tests.
 */
export function pruneFileTreeCache(
  liveSessionIds: ReadonlySet<string>,
  cache: Map<string, unknown> = treeCache,
): void {
  for (const key of cache.keys()) {
    const sessionId = key.slice(0, key.indexOf('::'));
    if (!liveSessionIds.has(sessionId)) cache.delete(key);
  }
}

function seedFrom(sessionId: string, rootPath: string): Map<string, NodeState> {
  return treeCache.get(cacheKey(sessionId, rootPath)) ?? seedNodes(rootPath);
}

function seedNodes(rootPath: string): Map<string, NodeState> {
  return new Map([
    [
      rootPath,
      {
        entry: {
          name: rootPath.split('/').filter(Boolean).pop() ?? rootPath,
          path: rootPath,
          hasChildren: true,
          isFile: false,
          ext: '',
        },
        expanded: true,
        loading: true,
      },
    ],
  ]);
}

// One toast per burst of failures: a deep refresh fans out to every loaded
// folder, and an offline server would otherwise stack one toast per folder.
const ERROR_TOAST_WINDOW_MS = 3000;
let lastErrorToastAt = -Infinity;
function toastFetchError(err: unknown): void {
  const now = Date.now();
  if (now - lastErrorToastAt < ERROR_TOAST_WINDOW_MS) return;
  lastErrorToastAt = now;
  toastError(err, 'Couldn’t load the folder');
}

function parentDir(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? p : p.slice(0, i);
}

/**
 * Directories (excluding root) whose children were already loaded — the set a
 * deep refresh must re-fetch. Unopened branches (children === undefined) stay
 * lazy. Exported for testing.
 */
export function loadedSubdirs(nodes: Map<string, NodeState>, rootPath: string): string[] {
  const out: string[] = [];
  for (const [path, node] of nodes) {
    if (path !== rootPath && !node.entry.isFile && node.children !== undefined) out.push(path);
  }
  return out;
}

/**
 * Given directories the server watcher reported changed, the subset already
 * known to the tree that should be re-fetched. A changed dir not in the map
 * falls back to its parent (so a brand-new nested folder appears under it);
 * a dir whose parent is also unknown is dropped (that branch is unopened).
 * Exported for testing.
 */
export function dirsToRefetch(nodes: Map<string, NodeState>, changed: string[]): string[] {
  const out = new Set<string>();
  for (const dir of changed) {
    if (nodes.has(dir)) out.add(dir);
    else {
      const parent = parentDir(dir);
      if (nodes.has(parent)) out.add(parent);
    }
  }
  return [...out];
}

export function useFileTree(rootPath: string, sessionId: string): UseFileTreeResult {
  const [nodes, setNodes] = useState<Map<string, NodeState>>(() => seedFrom(sessionId, rootPath));
  const [version, setVersion] = useState(0);
  // Latest nodes, readable from stable callbacks (refresh, socket handler)
  // without stale-closure capture. Synced after commit.
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  const [rootLoading, setRootLoading] = useState(true);
  const [rootError, setRootError] = useState<unknown>(null);
  const [currentRoot, setCurrentRoot] = useState(rootPath);
  const [edit, setEdit] = useState<TreeEdit | null>(null);

  // Reset state when rootPath changes. Pattern from React docs for derived-from-props state.
  if (currentRoot !== rootPath) {
    setCurrentRoot(rootPath);
    setNodes(seedFrom(sessionId, rootPath));
    setRootLoading(true);
    setRootError(null);
    setEdit(null);
  }

  // Never rejects: every caller fires it with `void`, so a failure must settle
  // the node here (spinner off, error on) instead of escaping as an unhandled
  // rejection and leaving the folder spinning forever. Resolves true on success.
  // `onError` replaces the toast (the root's failure is shown inline instead).
  const fetchChildren = useCallback(async (path: string, onError?: (err: unknown) => void): Promise<boolean> => {
    let res: Awaited<ReturnType<typeof api.getDirectoryChildren>>;
    try {
      res = await api.getDirectoryChildren(path, true);
    } catch (err) {
      setNodes((prev) => {
        const cur = prev.get(path);
        if (!cur) return prev;
        const next = new Map(prev);
        // A folder that never loaded collapses again so the next click retries;
        // one that already had children keeps showing them.
        const neverLoaded = cur.children === undefined;
        next.set(path, { ...cur, loading: false, error: true, expanded: neverLoaded ? false : cur.expanded });
        return next;
      });
      if (onError) onError(err);
      else toastFetchError(err);
      return false;
    }
    setNodes((prev) => {
      const next = new Map(prev);
      const cur = next.get(path);
      const childPaths: string[] = [];
      for (const entry of res.entries) {
        childPaths.push(entry.path);
        // Always refresh the entry so renames/type changes are reflected.
        const existing = next.get(entry.path);
        next.set(entry.path, { entry, expanded: existing?.expanded ?? false, loading: false, children: existing?.children });
      }
      next.set(path, {
        entry: cur?.entry ?? {
          name: path.split('/').filter(Boolean).pop() ?? path,
          path,
          hasChildren: childPaths.length > 0,
          isFile: false,
          ext: '',
        },
        children: childPaths,
        expanded: cur?.expanded ?? false,
        loading: false,
        error: false,
      });
      return next;
    });
    return true;
  }, []);

  // Bootstrap root on mount / rootPath / version change.
  useEffect(() => {
    let cancelled = false;
    let failure: unknown = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchChildren(rootPath, (err) => { failure = err ?? new Error('Couldn’t list the folder'); }).then((ok) => {
      if (cancelled) return;
      setRootError(ok ? null : failure);
      setRootLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [rootPath, fetchChildren, version]);

  // Persist node map so a remount (explorer modal, reopen) restores the same
  // expanded structure instead of collapsing back to root.
  useEffect(() => {
    treeCache.set(cacheKey(sessionId, rootPath), nodes);
  }, [nodes, sessionId, rootPath]);

  // Live updates: when the server watcher reports filesystem changes for this
  // session, re-fetch just the affected (already-loaded) folders so new files
  // and folders appear without a manual refresh. Unopened branches stay lazy.
  const socket = useSocket();
  useEffect(() => {
    const handler = (payload: { sessionId: string; dirs: string[] }) => {
      if (payload.sessionId !== sessionId) return;
      for (const dir of dirsToRefetch(nodesRef.current, payload.dirs)) void fetchChildren(dir);
    };
    socket.on('session:fsChanged', handler);
    return () => {
      socket.off('session:fsChanged', handler);
    };
  }, [socket, sessionId, fetchChildren]);

  const toggle = useCallback((path: string) => {
    setNodes((prev) => {
      const cur = prev.get(path);
      if (!cur || cur.entry.isFile) return prev;
      const next = new Map(prev);
      const expanding = !cur.expanded;
      next.set(path, { ...cur, expanded: expanding, loading: expanding && cur.children === undefined });
      return next;
    });
    // Fire fetch outside state setter
    const cur = nodes.get(path);
    if (cur && !cur.expanded && cur.children === undefined && !cur.entry.isFile) {
      void fetchChildren(path);
    }
  }, [nodes, fetchChildren]);

  const refresh = useCallback(() => {
    // Deep re-scan: bump version (re-reads the root via the bootstrap effect)
    // AND re-fetch every already-loaded subfolder. A version bump alone only
    // re-read the root, so new files inside expanded nested folders never
    // appeared. Only dirs whose children were fetched are refreshed —
    // unopened branches stay lazy.
    setVersion((v) => v + 1);
    for (const dir of loadedSubdirs(nodesRef.current, rootPath)) void fetchChildren(dir);
  }, [rootPath, fetchChildren]);

  // --- Inline create / rename / delete --------------------------------------

  const beginCreate = useCallback((parentPath: string, isDir: boolean) => {
    setEdit({ kind: 'create', parentPath, isDir });
    // Make sure the target folder is expanded so the draft row is visible.
    setNodes((prev) => {
      const cur = prev.get(parentPath);
      if (!cur || cur.expanded) return prev;
      const next = new Map(prev);
      next.set(parentPath, { ...cur, expanded: true, loading: cur.children === undefined });
      return next;
    });
    const cur = nodes.get(parentPath);
    if (cur && cur.children === undefined) void fetchChildren(parentPath);
  }, [nodes, fetchChildren]);

  const beginRename = useCallback((path: string, currentName: string) => {
    setEdit({ kind: 'rename', path, currentName });
  }, []);

  const cancelEdit = useCallback(() => setEdit(null), []);

  const failEdit = useCallback((title: string, reason?: string) => {
    setEdit((cur) => (cur ? { ...cur, error: reason ? `${title}: ${reason}` : title } : cur));
  }, []);

  const submitEdit = useCallback(async (rawName: string): Promise<boolean> => {
    if (!edit) return false;
    const name = rawName.trim().replace(/\/+$/, '');
    if (!name) { setEdit(null); return false; }

    try {
      if (edit.kind === 'create') {
        const target = `${edit.parentPath}/${name}`;
        const res = await api.createFile(sessionId, target, edit.isDir);
        if (!res.success) {
          failEdit(`Couldn’t create ${name}`, res.error);
          return false; // keep the input open so the name can be fixed
        }
        setEdit(null);
        await fetchChildren(edit.parentPath); // the new row is the confirmation
        return true;
      }
      // rename
      if (name === edit.currentName) { setEdit(null); return true; }
      const dir = parentDir(edit.path);
      const target = `${dir}/${name}`;
      const res = await api.renameFile(sessionId, edit.path, target);
      if (!res.success) {
        failEdit(`Couldn’t rename to ${name}`, res.error);
        return false;
      }
      setEdit(null);
      await fetchChildren(dir); // the renamed row is the confirmation
      return true;
    } catch (err) {
      failEdit(edit.kind === 'create' ? `Couldn’t create ${name}` : `Couldn’t rename to ${name}`, err instanceof Error ? err.message : undefined);
      return false;
    }
  }, [edit, sessionId, fetchChildren, failEdit]);

  // Delete goes to the server's staged trash, so it asks nothing and offers
  // Undo for 10 s. An item on another volume can't be staged: the caller then
  // confirms and calls again with `permanent` (docs/design/feedback-surfaces.md).
  const removePath = useCallback(async (path: string, isDir: boolean, opts: { permanent?: boolean } = {}): Promise<RemoveResult> => {
    const name = `${path.split('/').pop()}${isDir ? '/' : ''}`;
    const dir = parentDir(path);
    try {
      const res = await api.deleteFile(sessionId, path, opts.permanent);
      if (res.needsPermanent) return 'needs-permanent';
      if (!res.success) {
        toastError(new Error(res.error ?? 'Failed to delete'), `Couldn’t delete ${name}`);
        return 'failed';
      }
      await fetchChildren(dir);
      const undoId = res.undoId;
      if (undoId) {
        offerUndo({
          message: `Deleted ${name}`,
          durationMs: UNDO_WINDOW_LONG_MS,
          undo: async () => {
            await api.restoreFile(sessionId, undoId);
            await fetchChildren(dir);
          },
        });
      }
      return 'deleted';
    } catch (err) {
      toastError(err, `Couldn’t delete ${name}`);
      return 'failed';
    }
  }, [sessionId, fetchChildren]);

  const visibleNodes = useMemo<VisibleNode[]>(() => {
    const out: VisibleNode[] = [];
    const walk = (path: string, depth: number) => {
      const node = nodes.get(path);
      if (!node) return;
      if (depth > 0) {
        out.push({
          path,
          depth: depth - 1,
          entry: node.entry,
          expanded: node.expanded,
          loading: node.loading,
          error: node.error,
        });
      }
      if (node.expanded) {
        // Draft "new file/folder" row sits at the top of its parent's children.
        if (edit?.kind === 'create' && edit.parentPath === path) {
          out.push({
            path: DRAFT_PATH,
            depth,
            entry: { name: '', path: DRAFT_PATH, hasChildren: false, isFile: !edit.isDir, ext: '' },
            expanded: false,
            loading: false,
            draft: true,
          });
        }
        if (node.children) {
          for (const childPath of node.children) {
            walk(childPath, depth + 1);
          }
        }
      }
    };
    walk(rootPath, 0);
    return out;
  }, [nodes, rootPath, edit]);

  return {
    rootPath,
    visibleNodes,
    toggle,
    refresh,
    isLoading: rootLoading,
    rootError,
    rootLoaded: nodes.get(rootPath)?.children !== undefined,
    edit,
    beginCreate,
    beginRename,
    cancelEdit,
    submitEdit,
    removePath,
  };
}
