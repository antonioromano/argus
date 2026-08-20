import type { SessionInfo } from '@argus/shared';
import { StatusDot } from '../../components/primitives/index.js';
import { AgentGlyph } from './AgentGlyph.js';
import { shellLabel } from '../../utils/sessionLabel.js';
import { useSessionMenu } from './sessionMenuContext.js';
import { SessionRenameInput } from './SessionRenameInput.js';

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
 * the header is draggable for native HTML5 reordering. Right-click opens the
 * shared shell action menu; while renaming, the label becomes an input and the
 * chip stops being draggable so a text selection isn't read as a drag.
 */
export function MinimizedChip({ session, onClick, onDragStart, onDragOver, onDrop, onDragEnd, isDropTarget }: MinimizedChipProps) {
  const sessionMenu = useSessionMenu();
  const renaming = sessionMenu.isRenaming(session.id, 'chip');
  return (
    <button
      className="argus-chip"
      draggable={!renaming}
      data-drop-target={isDropTarget || undefined}
      onClick={onClick}
      onContextMenu={(e) => sessionMenu.openMenu(session, e, 'chip')}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
    >
      <StatusDot status={session.status} size={6} />
      <AgentGlyph agent={session.agentType} size={14} />
      {renaming ? (
        <SessionRenameInput
          initial={shellLabel(session)}
          onCommit={(v) => sessionMenu.commitRename(session.id, v)}
          onCancel={sessionMenu.cancelRename}
          style={{ width: 120, flex: '0 0 auto' }}
        />
      ) : (
        <span className="argus-chip-label">{shellLabel(session)}</span>
      )}
      {session.hasGitChanges && <span className="argus-chip-dirty" />}
    </button>
  );
}
