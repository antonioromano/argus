import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useVirtualTree, type VirtualRow } from '../../hooks/useVirtualTree.js';
import type { GitFileStatusCode } from '@argus/shared';
import type { DirectoryEntry } from '@argus/shared';

interface VirtualFileTreeProps {
  rootPath: string;
  gitStatusMap?: Record<string, GitFileStatusCode>;
  filterQuery?: string;
  showUntracked?: boolean;
  showIgnored?: boolean;
  selectedFilePath: string | null;
  onFileSelect: (path: string, ext: string) => void;
  onRenameRequest?: (entry: DirectoryEntry) => void;
  onDeleteRequest?: (entry: DirectoryEntry) => void;
  renderRow: (
    row: VirtualRow,
    isSelected: boolean,
    onToggleExpand: (path: string) => Promise<void>,
  ) => React.ReactNode;
}

export function VirtualFileTree({
  rootPath,
  gitStatusMap,
  filterQuery,
  showUntracked,
  showIgnored,
  selectedFilePath,
  onFileSelect,
  onRenameRequest,
  onDeleteRequest,
  renderRow,
}: VirtualFileTreeProps) {
  const { rows, isLoading, toggleExpand } = useVirtualTree({
    rootPath,
    gitStatusMap,
    filterQuery,
    showUntracked,
    showIgnored,
    selectedFilePath,
  });

  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 10,
  });

  // Keyboard cursor index (independent of "open file" selectedFilePath)
  const [kbFocusIdx, setKbFocusIdx] = useState(-1);

  // Sync keyboard cursor when selectedFilePath changes (e.g. click, programmatic)
  useEffect(() => {
    if (selectedFilePath) {
      const idx = rows.findIndex(r => r.entry.path === selectedFilePath);
      if (idx >= 0) setKbFocusIdx(idx);
    }
  }, [selectedFilePath, rows]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return;
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = kbFocusIdx < rows.length - 1 ? kbFocusIdx + 1 : (kbFocusIdx < 0 ? 0 : kbFocusIdx);
        setKbFocusIdx(next);
        virtualizer.scrollToIndex(next, { align: 'auto' });
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (kbFocusIdx <= 0) break;
        setKbFocusIdx(kbFocusIdx - 1);
        virtualizer.scrollToIndex(kbFocusIdx - 1, { align: 'auto' });
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const idx = kbFocusIdx >= 0 ? kbFocusIdx : rows.findIndex(r => r.entry.path === selectedFilePath);
        if (idx < 0 || idx >= rows.length) break;
        const row = rows[idx];
        if (row.entry.isFile) {
          onFileSelect(row.entry.path, row.entry.ext);
        } else {
          void toggleExpand(row.entry.path);
        }
        break;
      }
      case 'F2': {
        e.preventDefault();
        const idx = kbFocusIdx >= 0 ? kbFocusIdx : rows.findIndex(r => r.entry.path === selectedFilePath);
        if (idx >= 0 && idx < rows.length) onRenameRequest?.(rows[idx].entry);
        break;
      }
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        const idx = kbFocusIdx >= 0 ? kbFocusIdx : rows.findIndex(r => r.entry.path === selectedFilePath);
        if (idx >= 0 && idx < rows.length) onDeleteRequest?.(rows[idx].entry);
        break;
      }
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: '8px 4px' }}>
        {[80, 60, 90, 50, 70, 65, 85, 45].map((w, i) => (
          <div
            key={i}
            style={{
              height: '22px',
              margin: '2px 0',
              background: 'var(--color-bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              width: `${w}%`,
              opacity: 0.5,
            }}
          />
        ))}
      </div>
    );
  }

  if (rows.length === 0 && filterQuery) {
    return (
      <div style={{ padding: '16px', color: 'var(--color-text-muted)', fontSize: '12px' }}>
        No files match &apos;{filterQuery}&apos;
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div style={{
        padding: '16px 12px',
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-muted)',
        fontStyle: 'italic',
      }}>
        Empty directory
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ overflow: 'auto', height: '100%', position: 'relative', outline: 'none' }}
    >
      {/* Spacer that gives the virtualizer its total scroll height */}
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualItem => {
          const row = rows[virtualItem.index];
          const isSelected = selectedFilePath === row.entry.path;
          const isKbFocused = kbFocusIdx === virtualItem.index;
          return (
            <div
              key={virtualItem.key}
              data-filepath={row.entry.path}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
                outline: isKbFocused && !isSelected ? '1px solid var(--color-accent, #4a90e2)' : 'none',
                outlineOffset: '-1px',
              }}
            >
              {renderRow(row, isSelected, toggleExpand)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
