import { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { ChangelistStateResponse, ChangelistEntry, GitFileStatusCode } from '@argus/shared';

interface ChangelistFileListProps {
  changelists: ChangelistStateResponse;
  activeId: string;
  changedFilePaths: string[];
  stagedFilePaths: Set<string>;
  unstagedOnlyFilePaths: Set<string>;
  gitStatuses: Record<string, GitFileStatusCode>;
  selectedFilePath: string | null;
  onSelectFile: (filePath: string, source: 'unstaged' | 'staged' | 'branch') => void;
  onSetActive: (id: string) => void;
  onMoveFile: (fileKey: string, targetListId: string) => void;
  showUntracked: boolean;
}

function StatusBadge({ status }: { status: GitFileStatusCode }) {
  const color = status === '?' ? 'var(--color-success)'
    : status === 'D' ? 'var(--color-error)'
    : 'var(--color-warning)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '14px', height: '14px', borderRadius: '3px',
      fontSize: '9px', fontWeight: 700, color: '#fff', flexShrink: 0,
      background: color,
    }}>
      {status === '!!' ? 'I' : status}
    </span>
  );
}

interface DraggableFileRowProps {
  fileKey: string;
  status: GitFileStatusCode;
  isSelected: boolean;
  isUnstagedOnly: boolean;
  onSelect: () => void;
}

function DraggableFileRow({ fileKey, status, isSelected, isUnstagedOnly, onSelect }: DraggableFileRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: fileKey });

  // Split path into filename + parent directory for display
  const lastSlash = fileKey.lastIndexOf('/');
  const filename = lastSlash === -1 ? fileKey : fileKey.slice(lastSlash + 1);
  const parentPath = lastSlash === -1 ? '' : fileKey.slice(0, lastSlash);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '2px 8px 2px 24px',
        cursor: isDragging ? 'grabbing' : 'pointer',
        background: isSelected ? 'var(--color-accent, #4a90e2)' : 'transparent',
        fontSize: '12px',
        opacity: isDragging ? 0.5 : 1,
        userSelect: 'none',
      }}
    >
      <StatusBadge status={status} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isSelected ? '#fff' : undefined, fontWeight: isSelected ? 500 : undefined }}>
        {filename}
      </span>
      {parentPath && (
        <span style={{ color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, maxWidth: '120px' }}>
          {parentPath}
        </span>
      )}
      {isUnstagedOnly && (
        <span
          title="Stage changes to include in commit"
          style={{ color: 'var(--color-warning)', flexShrink: 0 }}
        >
          ⚠
        </span>
      )}
    </div>
  );
}

interface DroppableSectionHeaderProps {
  list: ChangelistEntry;
  isActive: boolean;
  isCollapsed: boolean;
  stagedCount: number;
  unstagedOnlyCount: number;
  onClick: () => void;
}

function DroppableSectionHeader({ list, isActive, isCollapsed, stagedCount, unstagedOnlyCount, onClick }: DroppableSectionHeaderProps) {
  const { setNodeRef, isOver } = useDroppable({ id: list.id });

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '4px 8px', cursor: 'pointer',
        background: isOver
          ? 'var(--color-accent-muted, rgba(74,144,226,0.25))'
          : isActive
          ? 'var(--color-accent-muted, rgba(74,144,226,0.15))'
          : 'transparent',
        borderLeft: isActive ? '2px solid var(--color-accent, #4a90e2)' : '2px solid transparent',
        userSelect: 'none',
        fontSize: '12px', fontWeight: 600,
        transition: 'background 0.1s',
      }}
    >
      {isCollapsed
        ? <ChevronRight size={12} style={{ flexShrink: 0 }} />
        : <ChevronDown size={12} style={{ flexShrink: 0 }} />
      }
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {list.name}
      </span>
      <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--color-text-muted)', flexShrink: 0 }}>
        {stagedCount}
      </span>
      {unstagedOnlyCount > 0 && (
        <span title="files with unstaged changes only" style={{ flexShrink: 0 }}>⚠</span>
      )}
    </div>
  );
}

export function ChangelistFileList({
  changelists,
  activeId,
  changedFilePaths,
  stagedFilePaths,
  unstagedOnlyFilePaths,
  gitStatuses,
  selectedFilePath,
  onSelectFile,
  onSetActive,
  onMoveFile,
  showUntracked,
}: ChangelistFileListProps) {
  // Track collapsed state for each section — default: none collapsed
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Filter out untracked files if showUntracked is false
  const visibleFilePaths = showUntracked
    ? changedFilePaths
    : changedFilePaths.filter(fp => gitStatuses[fp] !== '?');

  // Build a set of all file keys already explicitly assigned to a non-default list
  const assignedToNonDefault = useMemo(() => {
    const s = new Set<string>();
    for (const list of changelists.lists) {
      if (!list.isDefault) for (const fk of list.fileKeys) s.add(fk);
    }
    return s;
  }, [changelists.lists]);

  const getFilesForList = useCallback((list: ChangelistEntry): string[] => {
    if (list.isDefault) return visibleFilePaths.filter(fp => !assignedToNonDefault.has(fp));
    return list.fileKeys.filter(fk => visibleFilePaths.includes(fk));
  }, [visibleFilePaths, assignedToNonDefault]);

  const determineSource = useCallback((filePath: string): 'unstaged' | 'staged' | 'branch' => {
    if (stagedFilePaths.has(filePath)) return 'staged';
    if (unstagedOnlyFilePaths.has(filePath)) return 'unstaged';
    return 'branch';
  }, [stagedFilePaths, unstagedOnlyFilePaths]);

  // Flat ordered list of visible file keys for keyboard navigation
  const visibleItems = useMemo(() => {
    const items: Array<{ fileKey: string; source: 'unstaged' | 'staged' | 'branch' }> = [];
    for (const list of changelists.lists) {
      if (collapsed[list.id]) continue;
      for (const fk of getFilesForList(list)) {
        items.push({ fileKey: fk, source: determineSource(fk) });
      }
    }
    return items;
  }, [changelists.lists, collapsed, getFilesForList, determineSource]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (visibleItems.length === 0) return;
    const idx = visibleItems.findIndex(item => item.fileKey === selectedFilePath);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = idx < visibleItems.length - 1 ? idx + 1 : (idx < 0 ? 0 : idx);
      if (next !== idx || idx < 0) onSelectFile(visibleItems[next < 0 ? 0 : next].fileKey, visibleItems[next < 0 ? 0 : next].source);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) onSelectFile(visibleItems[idx - 1].fileKey, visibleItems[idx - 1].source);
    }
  };

  if (visibleFilePaths.length === 0) return null;

  function handleHeaderClick(list: ChangelistEntry) {
    if (list.id !== activeId) {
      onSetActive(list.id);
    } else {
      setCollapsed(prev => ({ ...prev, [list.id]: !prev[list.id] }));
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const fileKey = active.id as string;
    const targetListId = over.id as string;
    const targetList = changelists.lists.find(l => l.id === targetListId);
    if (!targetList) return;
    onMoveFile(fileKey, targetListId);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{ display: 'flex', flexDirection: 'column', outline: 'none' }}
      >
        {changelists.lists.map(list => {
          const filesInList = getFilesForList(list);
          const isActive = list.id === activeId;
          const isCollapsed = !!collapsed[list.id];

          const stagedCount = filesInList.filter(fp => stagedFilePaths.has(fp)).length;
          const unstagedOnlyCount = filesInList.filter(fp => unstagedOnlyFilePaths.has(fp)).length;

          return (
            <div key={list.id}>
              <DroppableSectionHeader
                list={list}
                isActive={isActive}
                isCollapsed={isCollapsed}
                stagedCount={stagedCount}
                unstagedOnlyCount={unstagedOnlyCount}
                onClick={() => handleHeaderClick(list)}
              />
              {!isCollapsed && filesInList.map(fileKey => {
                const status: GitFileStatusCode = gitStatuses[fileKey] ?? 'M';
                const isSelected = fileKey === selectedFilePath;
                const isUnstagedOnly = unstagedOnlyFilePaths.has(fileKey);
                const source = determineSource(fileKey);

                return (
                  <DraggableFileRow
                    key={fileKey}
                    fileKey={fileKey}
                    status={status}
                    isSelected={isSelected}
                    isUnstagedOnly={isUnstagedOnly}
                    onSelect={() => onSelectFile(fileKey, source)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}
