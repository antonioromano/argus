import { useState, useRef } from 'react';
import type { BlameLineEntry } from '@argus/shared';
import { HunkActionPopover } from './HunkActionPopover.js';
import { BlameOverlay } from './BlameOverlay.js';

interface DiffGutterProps {
  oldLineNo: number | null;
  newLineNo: number | null;
  lineType: 'context' | 'del' | 'add' | 'spacer';
  diffSection: 'unstaged' | 'staged' | 'branch';
  hunkIndex: number;
  onStageHunk?: () => void;
  onDiscardHunk?: () => void;
  onUnstageHunk?: () => void;
  onCopyHunk?: () => void;
  blameEntry?: BlameLineEntry;
  /** Only the first line of a hunk renders action buttons on hover. */
  isFirstLineOfHunk?: boolean;
}

/** Small icon-label action button used inside the gutter action row. */
interface ActionButtonProps {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  color: string;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}

function ActionButton({ label, onClick, color, buttonRef }: ActionButtonProps) {
  return (
    <button
      ref={buttonRef}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      style={{
        background: 'none',
        border: `1px solid ${color}`,
        borderRadius: '3px',
        padding: '1px 6px',
        cursor: 'pointer',
        fontSize: '11px',
        color,
        fontFamily: 'var(--font-sans, sans-serif)',
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        transition: 'background 0.1s, opacity 0.1s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = `${color}22`;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'none';
      }}
    >
      {label}
    </button>
  );
}

/**
 * Gutter component for a single diff row.
 *
 * Renders:
 *  - Old and new line number columns (44px each, matching DiffHunk.tsx)
 *  - A 2px colored change bar (red / green / transparent)
 *  - On hover when isFirstLineOfHunk is true: context-sensitive action buttons
 *  - Optional BlameOverlay annotation when blameEntry is provided
 */
export function DiffGutter({
  oldLineNo,
  newLineNo,
  lineType,
  diffSection,
  hunkIndex: _hunkIndex, // available for callers that key hunks; not used for rendering
  onStageHunk,
  onDiscardHunk,
  onUnstageHunk,
  onCopyHunk,
  blameEntry,
  isFirstLineOfHunk,
}: DiffGutterProps) {
  const [hovered, setHovered] = useState(false);
  const [showDiscardPopover, setShowDiscardPopover] = useState(false);
  const discardBtnRef = useRef<HTMLButtonElement | null>(null);

  // Change-bar color follows the line type
  const changeBarColor =
    lineType === 'del'
      ? 'var(--color-diff-del-border, #e74c3c)'
      : lineType === 'add'
      ? 'var(--color-diff-add-border, #2ecc71)'
      : 'transparent';

  // Determine which action buttons are relevant for this section/line
  const canActOnHunk = isFirstLineOfHunk === true && lineType !== 'spacer';
  const showStage = canActOnHunk && diffSection === 'unstaged' && !!onStageHunk;
  const showDiscard = canActOnHunk && diffSection === 'unstaged' && !!onDiscardHunk;
  const showUnstage = canActOnHunk && diffSection === 'staged' && !!onUnstageHunk;
  const showCopy = canActOnHunk && !!onCopyHunk;

  const hasAnyAction = showStage || showDiscard || showUnstage || showCopy;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'stretch',
        height: '20px',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
      }}
    >
      {/* Old line number */}
      <span
        style={{
          width: '44px',
          minWidth: '44px',
          textAlign: 'right',
          padding: '0 4px',
          color: 'var(--color-diff-line-num)',
          lineHeight: '20px',
          userSelect: 'none',
        }}
      >
        {oldLineNo ?? ''}
      </span>

      {/* New line number */}
      <span
        style={{
          width: '44px',
          minWidth: '44px',
          textAlign: 'right',
          padding: '0 4px',
          color: 'var(--color-diff-line-num)',
          lineHeight: '20px',
          userSelect: 'none',
        }}
      >
        {newLineNo ?? ''}
      </span>

      {/* 2px colored change bar */}
      <span
        style={{
          width: '2px',
          minWidth: '2px',
          background: changeBarColor,
          alignSelf: 'stretch',
        }}
      />

      {/* Blame annotation — shown when a blame entry is provided */}
      {blameEntry && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            minWidth: '120px',
            maxWidth: '160px',
            paddingLeft: '6px',
            overflow: 'hidden',
          }}
        >
          <BlameOverlay entry={blameEntry} />
        </div>
      )}

      {/* Action buttons — visible on hover for the first line of each hunk */}
      {hovered && hasAnyAction && (
        <div
          style={{
            position: 'absolute',
            right: '4px',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            gap: '4px',
            alignItems: 'center',
            zIndex: 10,
          }}
        >
          {showStage && (
            <ActionButton
              label="Stage"
              onClick={onStageHunk!}
              color="var(--color-success, #2ecc71)"
            />
          )}
          {showDiscard && (
            <ActionButton
              label="Discard"
              buttonRef={discardBtnRef}
              onClick={() => setShowDiscardPopover(true)}
              color="var(--color-error, #e74c3c)"
            />
          )}
          {showUnstage && (
            <ActionButton
              label="Unstage"
              onClick={onUnstageHunk!}
              color="var(--color-warning, #f39c12)"
            />
          )}
          {showCopy && (
            <ActionButton
              label="Copy"
              onClick={onCopyHunk!}
              color="var(--color-text-secondary, rgba(255,255,255,0.5))"
            />
          )}
        </div>
      )}

      {/* Discard confirmation popover */}
      {showDiscardPopover && (
        <HunkActionPopover
          anchorRef={discardBtnRef as React.RefObject<HTMLElement | null>}
          onConfirm={() => {
            setShowDiscardPopover(false);
            onDiscardHunk!();
          }}
          onCancel={() => setShowDiscardPopover(false)}
        />
      )}
    </div>
  );
}
