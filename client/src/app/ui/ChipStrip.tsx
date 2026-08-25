import { useRef, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { MinimizedChip } from './MinimizedChip.js';
import { filterSessions } from '../../utils/sessionFilter.js';

interface ChipStripProps {
  sessions: SessionInfo[];
  activeId: string;
  filter?: string;
  onSelect: (id: string) => void;
  /** Persist a new full ordering of session ids (global session order). */
  onReorder: (newOrderedIds: string[]) => void;
  /** True when a session is owned by a different window (multi-window). */
  isForeign?: (id: string) => boolean;
  /** Label of the window that owns a foreign session, for the chip badge. */
  foreignLabel?: (id: string) => string;
}

export function ChipStrip({ sessions, activeId, filter, onSelect, onReorder, isForeign, foreignLabel }: ChipStripProps) {
  const others = filterSessions(sessions, filter ?? '').filter((s) => s.id !== activeId);

  // Native HTML5 drag-to-reorder. Splices over the full `sessions` id list so the
  // reorder stays correct even while filtered/sliced.
  const dragId = useRef<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const handleDragStart = (id: string) => { dragId.current = id; };
  const handleDragEnd = () => { dragId.current = null; setDropTargetId(null); };
  const handleDragOver = (id: string) => {
    if (dragId.current && dragId.current !== id) setDropTargetId(id);
  };
  const handleDrop = (targetId: string) => {
    const src = dragId.current;
    dragId.current = null;
    setDropTargetId(null);
    if (!src || src === targetId) return;
    const ids = sessions.map((s) => s.id);
    const from = ids.indexOf(src);
    if (from === -1 || ids.indexOf(targetId) === -1) return;
    ids.splice(from, 1);
    ids.splice(ids.indexOf(targetId), 0, src);
    onReorder(ids);
  };

  return (
    <div
      className="argus-scroll"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s-2)',
        padding: 'var(--s-1) var(--s-4)',
        background: 'var(--bg-1)',
        borderBottom: '1px solid var(--line-2)',
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      <span className="eyebrow" style={{ marginRight: 'var(--s-2)', flexShrink: 0 }}>
        OTHERS · {others.length}
      </span>
      {others.map((s) => (
        <MinimizedChip
          key={s.id}
          session={s}
          onClick={() => onSelect(s.id)}
          onDragStart={() => handleDragStart(s.id)}
          onDragOver={() => handleDragOver(s.id)}
          onDrop={() => handleDrop(s.id)}
          onDragEnd={handleDragEnd}
          isDropTarget={dropTargetId === s.id}
          windowBadge={isForeign?.(s.id) ? foreignLabel?.(s.id) : undefined}
        />
      ))}
    </div>
  );
}
