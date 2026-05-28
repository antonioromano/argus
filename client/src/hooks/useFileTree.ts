import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DirectoryEntry } from '@argus/shared';
import { api } from '../services/api.js';

interface NodeState {
  entry: DirectoryEntry;
  children?: string[];
  expanded: boolean;
  loading: boolean;
}

export interface VisibleNode {
  path: string;
  depth: number;
  entry: DirectoryEntry;
  expanded: boolean;
  loading: boolean;
}

export interface UseFileTreeResult {
  rootPath: string;
  visibleNodes: VisibleNode[];
  toggle: (path: string) => void;
  refresh: () => void;
  isLoading: boolean;
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

export function useFileTree(rootPath: string): UseFileTreeResult {
  const [nodes, setNodes] = useState<Map<string, NodeState>>(() => seedNodes(rootPath));
  const [version, setVersion] = useState(0);
  const [rootLoading, setRootLoading] = useState(true);
  const [currentRoot, setCurrentRoot] = useState(rootPath);

  // Reset state when rootPath changes. Pattern from React docs for derived-from-props state.
  if (currentRoot !== rootPath) {
    setCurrentRoot(rootPath);
    setNodes(seedNodes(rootPath));
    setRootLoading(true);
  }

  const fetchChildren = useCallback(async (path: string) => {
    const res = await api.getDirectoryChildren(path, true);
    setNodes((prev) => {
      const next = new Map(prev);
      const cur = next.get(path);
      const childPaths: string[] = [];
      for (const entry of res.entries) {
        childPaths.push(entry.path);
        if (!next.has(entry.path)) {
          next.set(entry.path, { entry, expanded: false, loading: false });
        }
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
      });
      return next;
    });
  }, []);

  // Bootstrap root on mount / rootPath / version change.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchChildren(rootPath).finally(() => {
      if (!cancelled) setRootLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [rootPath, fetchChildren, version]);

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
    setVersion((v) => v + 1);
  }, []);

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
        });
      }
      if (node.expanded && node.children) {
        for (const childPath of node.children) {
          walk(childPath, depth + 1);
        }
      }
    };
    walk(rootPath, 0);
    return out;
  }, [nodes, rootPath]);

  return { rootPath, visibleNodes, toggle, refresh, isLoading: rootLoading };
}
