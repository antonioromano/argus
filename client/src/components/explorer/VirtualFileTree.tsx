import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useVirtualTree, type VirtualRow } from '../../hooks/useVirtualTree.js';
import type { GitFileStatusCode } from '@argus/shared';

interface VirtualFileTreeProps {
  rootPath: string;
  gitStatusMap?: Record<string, GitFileStatusCode>;
  filterQuery?: string;
  showUntracked?: boolean;
  showIgnored?: boolean;
  selectedFilePath: string | null;
  onFileSelect: (path: string, ext: string) => void;
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
  onFileSelect: _onFileSelect,
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
      style={{ overflow: 'auto', height: '100%', position: 'relative' }}
    >
      {/* Spacer that gives the virtualizer its total scroll height */}
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualItem => {
          const row = rows[virtualItem.index];
          const isSelected = selectedFilePath === row.entry.path;
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
