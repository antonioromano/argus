import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DirectoryEntry } from '@argus/shared';
import { api } from '../services/api.js';

interface FolderTreeProps {
  onSelect: (path: string) => void;
  theme?: 'dark' | 'light';
}

interface TreeNode {
  entries: DirectoryEntry[];
  loading: boolean;
}

export function FolderTree({ onSelect }: FolderTreeProps) {
  const [treeData, setTreeData] = useState<Map<string, TreeNode>>(new Map());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [rootPath, setRootPath] = useState<string>('');

  // Load root on mount
  useEffect(() => {
    api.getDirectoryChildren().then((result) => {
      setRootPath(result.parentPath);
      setTreeData(new Map([[result.parentPath, { entries: result.entries, loading: false }]]));
      setExpandedPaths(new Set([result.parentPath]));
    }).catch(console.error);
  }, []);

  const toggleExpand = useCallback(async (dirPath: string) => {
    if (expandedPaths.has(dirPath)) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
      return;
    }

    if (!treeData.has(dirPath)) {
      setTreeData((prev) => new Map(prev).set(dirPath, { entries: [], loading: true }));
      try {
        const result = await api.getDirectoryChildren(dirPath);
        setTreeData((prev) => new Map(prev).set(dirPath, { entries: result.entries, loading: false }));
      } catch {
        setTreeData((prev) => new Map(prev).set(dirPath, { entries: [], loading: false }));
      }
    }

    setExpandedPaths((prev) => new Set(prev).add(dirPath));
  }, [expandedPaths, treeData]);

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path);
    onSelect(path);
  }, [onSelect]);

  // Flatten tree into renderable rows
  const rows: { entry: DirectoryEntry; depth: number; parentPath: string }[] = [];

  function buildRows(parentPath: string, depth: number) {
    const node = treeData.get(parentPath);
    if (!node) return;

    for (const entry of node.entries) {
      rows.push({ entry, depth, parentPath });
      if (expandedPaths.has(entry.path)) {
        buildRows(entry.path, depth + 1);
      }
    }
  }

  if (rootPath) {
    buildRows(rootPath, 0);
  }

  return (
    <div
      style={{
        maxHeight: '300px',
        overflowY: 'auto',
        border: '1px solid var(--color-border-base)',
        borderRadius: '6px',
        background: 'var(--color-bg-surface)',
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      {rows.length === 0 && (
        <div style={{ padding: '12px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
          Loading...
        </div>
      )}
      {rows.map(({ entry, depth }) => {
        const isExpanded = expandedPaths.has(entry.path);
        const isSelected = selectedPath === entry.path;
        const isLoading = treeData.get(entry.path)?.loading;

        return (
          <div
            key={entry.path}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '4px 8px',
              paddingLeft: `${8 + depth * 20}px`,
              cursor: 'pointer',
              background: isSelected ? 'var(--color-bg-elevated)' : 'transparent',
              fontSize: '13px',
              fontFamily: 'Menlo, Monaco, monospace',
              color: 'var(--color-text-primary)',
            }}
            onClick={() => handleSelect(entry.path)}
          >
            <span
              onClick={(e) => {
                e.stopPropagation();
                if (entry.hasChildren) toggleExpand(entry.path);
              }}
              style={{
                width: '18px',
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text-muted)',
                cursor: entry.hasChildren ? 'pointer' : 'default',
              }}
            >
              {isLoading ? '…' : entry.hasChildren
                ? (isExpanded
                    ? <ChevronDown size={11} strokeWidth={2} />
                    : <ChevronRight size={11} strokeWidth={2} />)
                : null}
            </span>
            <span style={{ marginLeft: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
