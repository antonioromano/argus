import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { DirectoryEntry, GitFileStatusCode } from '@argus/shared';
import { api } from '../services/api.js';

export interface TreeNode {
  entries: DirectoryEntry[];
  loading: boolean;
}

export interface VirtualRow {
  entry: DirectoryEntry;
  depth: number;
  gitStatus: GitFileStatusCode | undefined;
  effectiveBadge: GitFileStatusCode | undefined; // highest-priority badge for dirs
  isExpanded: boolean;
}

interface UseVirtualTreeOptions {
  rootPath: string;
  gitStatusMap?: Record<string, GitFileStatusCode>;
  filterQuery?: string;
  showUntracked?: boolean;
  showIgnored?: boolean;
  selectedFilePath?: string | null;
}

interface UseVirtualTreeResult {
  rows: VirtualRow[];
  isLoading: boolean;
  expandedPaths: Set<string>;
  toggleExpand: (dirPath: string) => Promise<void>;
  refetch: () => void;
}

// Priority order for git status badges — higher = more visible/important
const BADGE_PRIORITY: Record<string, number> = {
  '?': 6,
  'M': 5,
  'A': 4,
  'R': 3,
  'C': 2,
  'D': 1,
  '!!': 0,
};

/**
 * Compute the effective git badge for a directory entry.
 * For files: direct lookup by relative path.
 * For directories: find the highest-priority status among all gitStatusMap keys
 * whose absolute paths (rootPath + '/' + key) start with the directory's path.
 */
function getEffectiveBadge(
  entry: DirectoryEntry,
  gitStatusMap: Record<string, GitFileStatusCode>,
  rootPath: string,
): GitFileStatusCode | undefined {
  if (entry.isFile) {
    // File: derive relative key by stripping rootPath prefix
    const relKey = entry.path.startsWith(rootPath + '/')
      ? entry.path.slice(rootPath.length + 1)
      : entry.path;
    return gitStatusMap[relKey] as GitFileStatusCode | undefined;
  }

  // Directory: find the max-priority child status
  const dirPrefix = entry.path + '/';
  let best: GitFileStatusCode | undefined;
  let bestPriority = -1;

  for (const [key, status] of Object.entries(gitStatusMap)) {
    // Reconstruct absolute path for this gitStatusMap key
    const absPath = rootPath + '/' + key;
    if (absPath.startsWith(dirPrefix) || absPath === entry.path) {
      const p = BADGE_PRIORITY[status] ?? 0;
      if (p > bestPriority) {
        bestPriority = p;
        best = status as GitFileStatusCode;
      }
    }
  }
  return best;
}

/**
 * Fuzzy match: returns true if all characters of `query` appear in order in `target`.
 */
function fuzzyMatch(query: string, target: string): boolean {
  let qi = 0;
  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (target[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

/**
 * Build the set of paths that should be visible when a filter is active.
 * A file is visible if it fuzzy-matches the query.
 * A directory is visible if any of its descendant files match (we include it
 * as an ancestor so the user can see the tree structure).
 *
 * Since we only have loaded treeData, we walk the in-memory tree.
 */
function getFilterVisiblePaths(
  treeData: Map<string, TreeNode>,
  rootPath: string,
  query: string,
): Set<string> {
  const lq = query.toLowerCase();
  const visible = new Set<string>();

  function walk(parentPath: string): boolean {
    const node = treeData.get(parentPath);
    if (!node || node.loading) return false;
    let anyChildVisible = false;
    for (const entry of node.entries) {
      const relPath = entry.path.startsWith(rootPath + '/')
        ? entry.path.slice(rootPath.length + 1)
        : entry.path;
      const lp = relPath.toLowerCase();

      if (entry.isFile) {
        if (fuzzyMatch(lq, lp)) {
          visible.add(entry.path);
          anyChildVisible = true;
        }
      } else {
        // Directory: include it if any descendant matches
        const hasMatch = walk(entry.path);
        if (hasMatch) {
          visible.add(entry.path);
          anyChildVisible = true;
        }
      }
    }
    return anyChildVisible;
  }

  walk(rootPath);
  return visible;
}

export function useVirtualTree({
  rootPath,
  gitStatusMap = {},
  filterQuery = '',
  showUntracked = true,
  showIgnored = false,
  selectedFilePath = null,
}: UseVirtualTreeOptions): UseVirtualTreeResult {
  const [treeData, setTreeData] = useState<Map<string, TreeNode>>(new Map());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const fetchCounterRef = useRef(0);

  // ── Initial root load ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rootPath) return;

    const id = ++fetchCounterRef.current;
    setIsLoading(true);
    setTreeData(new Map());
    setExpandedPaths(new Set());

    api.getDirectoryChildren(rootPath, true)
      .then((result) => {
        if (fetchCounterRef.current !== id) return;
        setTreeData(new Map([[rootPath, { entries: result.entries, loading: false }]]));
        setExpandedPaths(new Set([rootPath]));
        setIsLoading(false);
      })
      .catch(() => {
        if (fetchCounterRef.current !== id) return;
        setTreeData(new Map([[rootPath, { entries: [], loading: false }]]));
        setIsLoading(false);
      });
  }, [rootPath]);

  // ── Auto-reveal: expand ancestor directories when selectedFilePath changes ───
  const revealedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedFilePath || !rootPath || isLoading) return;
    if (selectedFilePath === revealedPathRef.current) return;
    if (!selectedFilePath.startsWith(rootPath)) return;
    revealedPathRef.current = selectedFilePath;

    const relative = selectedFilePath.slice(rootPath.length).replace(/^\//, '');
    const parts = relative.split('/');
    parts.pop(); // drop filename — only directories need expanding

    let currentDir = rootPath;
    const dirsToExpand: string[] = [rootPath];
    for (const part of parts) {
      currentDir = currentDir + '/' + part;
      dirsToExpand.push(currentDir);
    }

    let cancelled = false;
    (async () => {
      for (const dir of dirsToExpand) {
        if (cancelled) return;
        // Read current treeData without stale closure via functional updater trick
        const alreadyLoaded = await new Promise<boolean>(resolve => {
          setTreeData(prev => { resolve(prev.has(dir)); return prev; });
        });
        if (!alreadyLoaded) {
          try {
            const result = await api.getDirectoryChildren(dir, true);
            if (cancelled) return;
            setTreeData(prev => new Map(prev).set(dir, { entries: result.entries, loading: false }));
          } catch {
            break;
          }
        }
        setExpandedPaths(prev => new Set(prev).add(dir));
      }
      // Scroll the selected file into view after expanding
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-filepath="${CSS.escape(selectedFilePath)}"]`);
        el?.scrollIntoView({ block: 'nearest' });
      });
    })();

    return () => { cancelled = true; };
  }, [selectedFilePath, rootPath, isLoading]);

  // ── toggleExpand ─────────────────────────────────────────────────────────────
  const toggleExpand = useCallback(async (dirPath: string) => {
    // Collapse if already open
    if (expandedPaths.has(dirPath)) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
      return;
    }

    // Fetch children if not yet loaded
    if (!treeData.has(dirPath)) {
      setTreeData((prev) => new Map(prev).set(dirPath, { entries: [], loading: true }));
      try {
        const result = await api.getDirectoryChildren(dirPath, true);
        setTreeData((prev) => new Map(prev).set(dirPath, { entries: result.entries, loading: false }));
      } catch {
        setTreeData((prev) => new Map(prev).set(dirPath, { entries: [], loading: false }));
      }
    }

    setExpandedPaths((prev) => new Set(prev).add(dirPath));
  }, [expandedPaths, treeData]);

  // ── refetch ──────────────────────────────────────────────────────────────────
  const refetch = useCallback(() => {
    if (!rootPath) return;
    const id = ++fetchCounterRef.current;
    setIsLoading(true);
    setTreeData(new Map());
    setExpandedPaths(new Set());

    api.getDirectoryChildren(rootPath, true)
      .then((result) => {
        if (fetchCounterRef.current !== id) return;
        setTreeData(new Map([[rootPath, { entries: result.entries, loading: false }]]));
        setExpandedPaths(new Set([rootPath]));
        setIsLoading(false);
      })
      .catch(() => {
        if (fetchCounterRef.current !== id) return;
        setTreeData(new Map([[rootPath, { entries: [], loading: false }]]));
        setIsLoading(false);
      });
  }, [rootPath]);

  // ── buildFlatRows (memoized) ─────────────────────────────────────────────────
  const rows = useMemo<VirtualRow[]>(() => {
    if (isLoading) return [];

    // When a filter is active, pre-compute which paths should be visible
    const lq = filterQuery.trim().toLowerCase();
    const filterVisible = lq
      ? getFilterVisiblePaths(treeData, rootPath, lq)
      : null;

    const result: VirtualRow[] = [];

    function walk(parentPath: string, depth: number) {
      const node = treeData.get(parentPath);
      if (!node || node.loading) return;

      for (const entry of node.entries) {
        // Derive relative path key for direct gitStatusMap lookups
        const relKey = entry.path.startsWith(rootPath + '/')
          ? entry.path.slice(rootPath.length + 1)
          : entry.path;

        const status = gitStatusMap[relKey] as GitFileStatusCode | undefined;

        // Apply show/hide filters for untracked and ignored entries
        if (!showUntracked && status === '?') continue;
        if (!showIgnored && status === '!!') continue;

        // Apply fuzzy filter — skip entries not in the visible set when filter is active
        if (filterVisible !== null && !filterVisible.has(entry.path)) continue;

        const effectiveBadge = getEffectiveBadge(entry, gitStatusMap, rootPath);
        const isExpanded = expandedPaths.has(entry.path);

        result.push({ entry, depth, gitStatus: status, effectiveBadge, isExpanded });

        // Recurse into expanded directories (or all directories when filter is active,
        // so we can reach matching descendants without the user manually expanding)
        if (!entry.isFile && (isExpanded || filterVisible !== null)) {
          walk(entry.path, depth + 1);
        }
      }
    }

    walk(rootPath, 0);
    return result;
  }, [treeData, expandedPaths, gitStatusMap, filterQuery, showUntracked, showIgnored, rootPath, isLoading]);

  return { rows, isLoading, expandedPaths, toggleExpand, refetch };
}
