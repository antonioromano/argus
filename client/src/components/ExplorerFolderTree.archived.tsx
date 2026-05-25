import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, FolderOpen, FileText, FileCode, FileJson, ChevronRight, ChevronDown, GitCommit, ExternalLink } from 'lucide-react';
import type { DirectoryEntry, GitFileStatusCode } from '@argus/shared';
import { InlineIconLink } from './primitives/index.js';
import { api } from '../services/api.js';

export interface TreeNode {
  entries: DirectoryEntry[];
  loading: boolean;
}

interface ExplorerFolderTreeProps {
  rootPath: string;
  onFileSelect: (path: string, ext: string) => void;
  onFileDoubleClick?: (path: string) => void;
  selectedFilePath: string | null;
  gitStatusMap?: Record<string, GitFileStatusCode>;
  onOpenInDiff?: (fileName?: string) => void;
  /** When provided, renders an "Open" icon on each row that opens the file/folder with the system default app. */
  onOpenPath?: (entryPath: string, isFile: boolean) => void;
  /** Restore previously expanded paths (survives tab switches). */
  initialExpandedPaths?: Set<string>;
  /** Restore previously loaded tree data (survives tab switches). */
  initialTreeData?: Map<string, TreeNode>;
  /** Called whenever expandedPaths changes — parent can cache it. */
  onExpandedPathsChange?: (paths: Set<string>) => void;
  /** Called whenever treeData changes — parent can cache it. */
  onTreeDataChange?: (data: Map<string, TreeNode>) => void;
}

function FileIcon({ ext, color }: { ext: string; color?: string }) {
  const style = { width: 14, height: 14, flexShrink: 0 as const, color: color ?? 'var(--color-text-muted)' };
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') return <FileCode style={style} />;
  if (ext === '.json') return <FileJson style={style} />;
  return <FileText style={style} />;
}

function getGitStatusColor(status: GitFileStatusCode | undefined): string | undefined {
  if (!status) return undefined;
  switch (status) {
    case '?': return 'var(--color-success)';       // untracked — green
    case 'M': case 'A': case 'R': case 'C':        // modified/added/renamed/copied — yellow
      return 'var(--color-warning)';
    case 'D': return 'var(--color-error)';          // deleted — red
    case '!!': return 'var(--color-text-muted)';    // ignored — muted
    default: return 'var(--color-warning)';          // unmapped codes — treat as modified
  }
}

export function ExplorerFolderTree({ rootPath, onFileSelect, onFileDoubleClick, selectedFilePath, gitStatusMap, onOpenInDiff, onOpenPath, initialExpandedPaths, initialTreeData, onExpandedPathsChange, onTreeDataChange }: ExplorerFolderTreeProps) {
  const [treeData, setTreeDataRaw] = useState<Map<string, TreeNode>>(() => initialTreeData ?? new Map());
  const [expandedPaths, setExpandedPathsRaw] = useState<Set<string>>(() => initialExpandedPaths ?? new Set());
  const [isRootLoading, setIsRootLoading] = useState(() => !initialTreeData?.has(rootPath));
  const fetchCounterRef = useRef(0);

  // Wrappers that also notify parent of changes
  const setTreeData = useCallback((updater: Map<string, TreeNode> | ((prev: Map<string, TreeNode>) => Map<string, TreeNode>)) => {
    setTreeDataRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      onTreeDataChange?.(next);
      return next;
    });
  }, [onTreeDataChange]);

  const setExpandedPaths = useCallback((updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setExpandedPathsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      onExpandedPathsChange?.(next);
      return next;
    });
  }, [onExpandedPathsChange]);

  useEffect(() => {
    if (!rootPath) return;
    // Skip fetching if we already have cached data for this root
    if (initialTreeData?.has(rootPath) && initialExpandedPaths && initialExpandedPaths.size > 0) {
      setIsRootLoading(false);
      return;
    }
    const id = ++fetchCounterRef.current;
    setIsRootLoading(true);
    setTreeData(new Map());
    setExpandedPaths(new Set());

    api.getDirectoryChildren(rootPath, true).then((result) => {
      if (fetchCounterRef.current !== id) return;
      setTreeData(new Map([[rootPath, { entries: result.entries, loading: false }]]));
      setExpandedPaths(new Set([rootPath]));
      setIsRootLoading(false);
    }).catch(() => {
      if (fetchCounterRef.current !== id) return;
      setTreeData(new Map([[rootPath, { entries: [], loading: false }]]));
      setIsRootLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

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
        const result = await api.getDirectoryChildren(dirPath, true);
        setTreeData((prev) => new Map(prev).set(dirPath, { entries: result.entries, loading: false }));
      } catch {
        setTreeData((prev) => new Map(prev).set(dirPath, { entries: [], loading: false }));
      }
    }

    setExpandedPaths((prev) => new Set(prev).add(dirPath));
  }, [expandedPaths, treeData, setExpandedPaths, setTreeData]);

  // Auto-expand tree to reveal selectedFilePath (on mount or when it changes).
  // Waits for root loading to finish before attempting to expand ancestor dirs.
  const revealedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedFilePath || !rootPath || isRootLoading) return;
    if (selectedFilePath === revealedPathRef.current) return;
    if (!selectedFilePath.startsWith(rootPath)) return;
    revealedPathRef.current = selectedFilePath;

    const relative = selectedFilePath.slice(rootPath.length).replace(/^\//, '');
    const parts = relative.split('/');
    parts.pop(); // drop filename — only need directories

    let currentDir = rootPath;
    const dirsToExpand: string[] = [rootPath];
    for (const part of parts) {
      currentDir = currentDir + '/' + part;
      dirsToExpand.push(currentDir);
    }

    // Sequentially fetch (if needed) and expand each ancestor directory.
    // Uses functional setTreeData to avoid stale closure reads.
    let cancelled = false;
    (async () => {
      for (const dir of dirsToExpand) {
        if (cancelled) return;
        // Check latest treeData via a resolved promise trick — avoids stale closure
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
      // After expanding, scroll the selected file into view
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-filepath="${CSS.escape(selectedFilePath)}"]`);
        el?.scrollIntoView({ block: 'nearest' });
      });
    })();
    return () => { cancelled = true; };
  }, [selectedFilePath, rootPath, isRootLoading, setTreeData, setExpandedPaths]);

  // Flatten tree into renderable rows
  const rows: { entry: DirectoryEntry; depth: number }[] = [];

  function buildRows(parentPath: string, depth: number) {
    const node = treeData.get(parentPath);
    if (!node || node.loading) return;
    for (const entry of node.entries) {
      rows.push({ entry, depth });
      if (!entry.isFile && expandedPaths.has(entry.path)) {
        buildRows(entry.path, depth + 1);
      }
    }
  }

  if (!isRootLoading && rootPath) {
    buildRows(rootPath, 0);
  }

  if (isRootLoading) {
    return (
      <div style={{ padding: '8px 4px' }}>
        {[80, 60, 90, 50, 70, 65, 85, 45].map((w, i) => (
          <div key={i} style={{
            height: '22px',
            margin: '2px 0',
            background: 'var(--color-bg-elevated)',
            borderRadius: 'var(--radius-sm)',
            width: `${w}%`,
            opacity: 0.5,
          }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {rows.length === 0 && (
        <div style={{
          padding: '16px 12px',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
          fontStyle: 'italic',
        }}>
          Empty directory
        </div>
      )}
      {rows.map(({ entry, depth }) => {
        const isExpanded = expandedPaths.has(entry.path);
        const isSelected = selectedFilePath === entry.path;
        const isLoading = treeData.get(entry.path)?.loading;
        const gitStatus = gitStatusMap?.[entry.path];
        const statusColor = getGitStatusColor(gitStatus);
        const isIgnored = gitStatus === '!!';
        // Selection accent wins over status color
        const resolvedColor = isSelected
          ? 'var(--color-accent)'
          : statusColor ?? 'var(--color-text-secondary)';
        const isExpandedFolder = !entry.isFile && isExpanded;
        const iconColor = isSelected
          ? 'var(--color-accent)'
          : statusColor ?? (isExpandedFolder ? 'var(--color-accent)' : 'var(--color-text-muted)');

        return (
          <div
            key={entry.path}
            data-filepath={entry.path}
            draggable={entry.isFile}
            onDragStart={entry.isFile ? (e) => {
              e.dataTransfer.setData('application/x-argus-path', entry.path);
              e.dataTransfer.setData('text/plain', entry.path);
              e.dataTransfer.effectAllowed = 'copy';
            } : undefined}
            onClick={() => {
              if (entry.isFile) {
                onFileSelect(entry.path, entry.ext);
              } else {
                toggleExpand(entry.path);
              }
            }}
            onDoubleClick={(e) => {
              if (entry.isFile) {
                e.stopPropagation();
                onFileDoubleClick?.(entry.path);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              padding: '3px 8px',
              paddingLeft: `${8 + depth * 16}px`,
              cursor: 'pointer',
              background: isSelected
                ? 'var(--color-surface-bright, var(--color-bg-elevated))'
                : 'transparent',
              borderLeft: isSelected
                ? '2px solid var(--color-accent)'
                : '2px solid transparent',
              color: resolvedColor,
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
              transition: 'background var(--transition-fast), color var(--transition-fast)',
              userSelect: 'none',
              opacity: isIgnored && !isSelected ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isSelected) e.currentTarget.style.background = 'var(--color-bg-elevated)';
            }}
            onMouseLeave={(e) => {
              if (!isSelected) e.currentTarget.style.background = 'transparent';
            }}
          >
            {/* Expand/collapse arrow column (18px fixed) */}
            <span style={{ width: 18, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              {!entry.isFile && entry.hasChildren && (
                isLoading
                  ? <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>…</span>
                  : isExpanded
                    ? <ChevronDown size={11} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />
                    : <ChevronRight size={11} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />
              )}
            </span>

            {/* Icon */}
            {entry.isFile
              ? <FileIcon ext={entry.ext} color={iconColor} />
              : isExpanded
                ? <FolderOpen size={14} strokeWidth={1.75} style={{ color: iconColor, flexShrink: 0 }} />
                : <Folder size={14} strokeWidth={1.75} style={{ color: iconColor, flexShrink: 0 }} />
            }

            {/* Name */}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {entry.name}
            </span>

            {/* "Open with system default" — works for both files and folders */}
            {onOpenPath && (
              <InlineIconLink
                icon={ExternalLink}
                label={entry.isFile ? `Open ${entry.name}` : `Reveal ${entry.name} in Finder`}
                onClick={() => onOpenPath(entry.path, entry.isFile)}
                size={11}
                opacity={0.6}
              />
            )}

            {/* "View in Diff" shortcut — shown for files with actual changes (not ignored) */}
            {entry.isFile && onOpenInDiff && gitStatus && gitStatus !== '!!' && (
              <InlineIconLink icon={GitCommit} label="View in Diff" onClick={() => onOpenInDiff(entry.name)} size={11} opacity={0.6} />
            )}

            {/* File size badge */}
            {entry.isFile && entry.size !== undefined && (
              <span style={{
                fontSize: 10,
                color: 'var(--color-text-muted)',
                flexShrink: 0,
                marginLeft: 4,
              }}>
                {formatSize(entry.size)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
