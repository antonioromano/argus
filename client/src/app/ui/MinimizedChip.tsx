import type { SessionInfo, SessionPrSummary } from '@argus/shared';
import { Icon, StatusDot, Tooltip } from '../../components/primitives/index.js';
import { PR_STATE_ICON, PR_TONE_COLOR } from '../../utils/prFormat.js';
import { chipClass, chipPrSummary, describeChipPrs } from './chipFormat.js';
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
  windowBadge?: string;
}

/** Linked-PR glyph, coloured like the header PrChip; a count when there are several. */
function ChipPrs({ summary }: { summary: SessionPrSummary }) {
  const lead = summary.prs.find((p) => p.tone === summary.tone) ?? summary.prs[0];
  const lines = describeChipPrs(summary);
  const label = summary.count === 1 ? `Pull request: ${lines[0]}` : `${summary.count} pull requests: ${lines.join('; ')}`;
  return (
    <Tooltip content={<div>{lines.map((l, i) => <div key={i}>{l}</div>)}</div>}>
      <span className="argus-chip-pr" data-tone={summary.tone} role="img" aria-label={label} style={{ color: PR_TONE_COLOR[summary.tone] }}>
        <Icon icon={PR_STATE_ICON[lead.state]} size={11} strokeWidth={2} />
        {summary.count > 1 && <span className="argus-chip-pr-count">{summary.count}</span>}
      </span>
    </Tooltip>
  );
}

/**
 * What a shell pill shows after its name — shared by MinimizedChip and the
 * Mosaic minimized row: the session's PRs (glyph tinted by the most
 * action-needing one), `±` for uncommitted changes, and while `running` the
 * Mosaic tile's progress crawl along the bottom edge (the status dot does not
 * pulse: pulse means `waiting`).
 */
export function ChipMarks({ session }: { session: SessionInfo }) {
  const prs = chipPrSummary(session);
  return (
    <>
      {prs && <ChipPrs summary={prs} />}
      {session.hasGitChanges && (
        <Tooltip content="Uncommitted changes">
          <span className="argus-chip-dirty" role="img" aria-label="Uncommitted changes">±</span>
        </Tooltip>
      )}
      {session.status === 'running' && <span className="argus-tile-prog argus-chip-prog" aria-hidden><i /></span>}
    </>
  );
}

/**
 * Compact pill representing a non-foreground shell — used by the focus-view
 * OTHERS strip and the mosaic minimized row. Click acts (switch/restore);
 * the header is draggable for native HTML5 reordering. Right-click opens the
 * shared shell action menu; while renaming, the label becomes an input and the
 * chip stops being draggable so a text selection isn't read as a drag.
 */
export function MinimizedChip({ session, onClick, onDragStart, onDragOver, onDrop, onDragEnd, isDropTarget, windowBadge }: MinimizedChipProps) {
  const sessionMenu = useSessionMenu();
  const renaming = sessionMenu.isRenaming(session.id, 'chip');
  const className = chipClass(session);

  const body = (
    <>
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
      {windowBadge && <span className="argus-chip-window-badge">{windowBadge}</span>}
      <ChipMarks session={session} />
    </>
  );

  // While renaming the chip is a plain container, never a <button>.
  //
  // A button wrapping the rename <input> is invalid markup, and it costs the
  // feature: Space reaches the button's native activation behaviour instead of
  // the field, so the chip's own onClick fires, the session switches, and the
  // input unmounts mid-edit. Typing a name with a space in it was impossible.
  // The input already stops propagation, which cannot help here — activation is
  // a *default action*, and only preventDefault would cancel it, which would
  // swallow the space being typed along with it. The sidebar row never had the
  // bug because it is a div with role="button", which has no native activation.
  if (renaming) {
    return (
      <div
        className={className}
        data-drop-target={isDropTarget || undefined}
        onContextMenu={(e) => sessionMenu.openMenu(session, e, 'chip')}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(); }}
        onDrop={(e) => { e.preventDefault(); onDrop(); }}
        onDragEnd={onDragEnd}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      className={className}
      draggable
      data-drop-target={isDropTarget || undefined}
      onClick={onClick}
      onContextMenu={(e) => sessionMenu.openMenu(session, e, 'chip')}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={onDragEnd}
    >
      {body}
    </button>
  );
}
