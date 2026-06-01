import type { SessionInfo } from '@argus/shared';
import { StatusDot } from '../../components/primitives/index.js';
import { AgentGlyph } from './AgentGlyph.js';

interface MinimizedChipProps {
  session: SessionInfo;
  onClick: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  isDropTarget: boolean;
}

/**
 * Compact pill representing a non-foreground shell — used by the focus-view
 * OTHERS strip and the mosaic minimized row. Click acts (switch/restore);
 * the header is draggable for native HTML5 reordering.
 */
export function MinimizedChip({ session, onClick, onDragStart, onDragOver, onDrop, onDragEnd, isDropTarget }: MinimizedChipProps) {
  return (
    <button
      className="argus-chip"
      draggable
      data-drop-target={isDropTarget || undefined}
      onClick={onClick}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
    >
      <StatusDot status={session.status} size={6} />
      <AgentGlyph agent={session.agentType} size={14} />
      <span className="argus-chip-label">{session.name}</span>
      {session.hasGitChanges && <span className="argus-chip-dirty" />}
    </button>
  );
}
