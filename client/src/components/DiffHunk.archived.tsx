import type { ReactNode } from 'react';
import type parseDiff from 'parse-diff';
import { Undo2 } from 'lucide-react';
import { TriStateCheckbox } from './primitives/index.js';
import { chunkTriState } from '../hooks/useCommitMode.js';
import type { TriState } from '../hooks/useCommitMode.js';

interface CommitModeHunkProps {
  chunkIndex: number;
  chunkSelection: Set<number> | undefined;
  totalChanges: number;
  onToggleChunk: () => void;
  onToggleLine: (changeIndex: number) => void;
  onRevertChunk: () => void;
}

interface DiffHunkProps {
  chunk: parseDiff.Chunk;
  searchQuery?: string;
  commitMode?: CommitModeHunkProps;
  onRevertHunk?: () => void;
  wordWrap?: boolean;
}

function highlightText(text: string, query: string): ReactNode {
  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const parts: ReactNode[] = [];
  let last = 0;
  let idx = lower.indexOf(queryLower, last);
  while (idx !== -1) {
    if (idx > last) parts.push(text.slice(last, idx));
    parts.push(
      <mark
        key={idx}
        style={{
          background: 'rgba(255, 213, 79, 0.55)',
          color: 'inherit',
          borderRadius: '2px',
          padding: '0 1px',
        }}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    last = idx + query.length;
    idx = lower.indexOf(queryLower, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}


function triStateToChecked(state: TriState): boolean | 'indeterminate' {
  if (state === 'all') return true;
  if (state === 'partial') return 'indeterminate';
  return false;
}

export function DiffHunk({ chunk, searchQuery, commitMode, onRevertHunk, wordWrap }: DiffHunkProps) {
  const showCommit = !!commitMode;
  const showRevert = showCommit || !!onRevertHunk;

  // Compute hunk-level tri-state
  const hunkState = showCommit
    ? chunkTriState(commitMode!.chunkSelection, commitMode!.totalChanges)
    : 'none';

  return (
    <div>
      {/* Hunk header row */}
      <div
        data-hunk-header="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: showRevert ? '4px 4px 4px 8px' : '4px 12px',
          background: 'var(--color-diff-hunk-bg)',
          color: 'var(--color-diff-hunk-text)',
          fontSize: '12px',
          fontFamily: 'var(--font-mono)',
          gap: showRevert ? '6px' : 0,
        }}
      >
        {showCommit && (
          <TriStateCheckbox
            checked={triStateToChecked(hunkState)}
            onChange={commitMode!.onToggleChunk}
            label={`Toggle hunk selection`}
          />
        )}
        {showRevert && (
          <button
            onClick={(e) => { e.stopPropagation(); showCommit ? commitMode!.onRevertChunk() : onRevertHunk!(); }}
            title="Revert this hunk"
            aria-label="Revert this hunk"
            style={{
              background: 'none',
              border: 'none',
              padding: '4px',
              minWidth: '28px',
              minHeight: '28px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-secondary)',
              opacity: 0.85,
              flexShrink: 0,
              transition: 'opacity 0.15s, background 0.15s',
              borderRadius: '4px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(128,128,128,0.15)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.55'; e.currentTarget.style.background = 'none'; }}
          >
            <Undo2 size={11} strokeWidth={2} />
          </button>
        )}
        <span style={{ flex: 1 }}>{chunk.content}</span>
      </div>

      {/* Change rows */}
      {(() => {
        let changeIndex = 0; // tracks add/del line index for commit mode
        return chunk.changes.map((change, i) => {
          let bg = 'transparent';
          let gutterBg = 'transparent';
          let textColor = 'var(--color-diff-context-text)';
          let oldLn = '';
          let newLn = '';
          let prefix = ' ';
          const isChangeLine = change.type === 'add' || change.type === 'del';
          const thisChangeIndex = isChangeLine ? changeIndex++ : -1;

          const isSelected = showCommit && isChangeLine
            ? commitMode!.chunkSelection?.has(thisChangeIndex) ?? false
            : false;

          if (change.type === 'add') {
            bg = isSelected ? 'var(--color-diff-selected-highlight)' : 'var(--color-diff-add-bg)';
            gutterBg = 'var(--color-diff-add-gutter)';
            textColor = 'var(--color-diff-add-text)';
            newLn = String(change.ln);
            prefix = '+';
          } else if (change.type === 'del') {
            bg = isSelected ? 'var(--color-diff-selected-highlight)' : 'var(--color-diff-del-bg)';
            gutterBg = 'var(--color-diff-del-gutter)';
            textColor = 'var(--color-diff-del-text)';
            oldLn = String(change.ln);
            prefix = '-';
          } else {
            oldLn = String(change.ln1);
            newLn = String(change.ln2);
          }

          const borderLeft = change.type === 'add'
            ? '2px solid var(--color-diff-add-border)'
            : change.type === 'del'
            ? '2px solid var(--color-diff-del-border)'
            : 'none';

          return (
            <div
              key={i}
              onClick={
                showCommit && isChangeLine
                  ? () => commitMode!.onToggleLine(thisChangeIndex)
                  : undefined
              }
              style={{
                display: 'flex',
                background: bg,
                borderLeft,
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                lineHeight: '20px',
                cursor: showCommit && isChangeLine ? 'pointer' : undefined,
              }}
            >

              <span
                style={{
                  width: '44px',
                  minWidth: '44px',
                  textAlign: 'right',
                  padding: '0 4px',
                  color: 'var(--color-diff-line-num)',
                  background: gutterBg,
                  userSelect: 'none',
                }}
              >
                {oldLn}
              </span>
              <span
                style={{
                  width: '44px',
                  minWidth: '44px',
                  textAlign: 'right',
                  padding: '0 4px',
                  color: 'var(--color-diff-line-num)',
                  background: gutterBg,
                  userSelect: 'none',
                }}
              >
                {newLn}
              </span>
              <span
                style={{
                  width: '18px',
                  minWidth: '18px',
                  textAlign: 'center',
                  color: textColor,
                  userSelect: 'none',
                  fontWeight: 600,
                }}
              >
                {prefix}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: textColor,
                  padding: '0 8px',
                  whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
                  wordBreak: wordWrap ? 'break-all' : undefined,
                  overflowWrap: wordWrap ? 'break-word' : undefined,
                  overflow: 'hidden',
                  cursor: showCommit && isChangeLine ? undefined : 'text',
                  userSelect: showCommit ? undefined : 'text',
                }}
              >
                {searchQuery ? highlightText(change.content.slice(1), searchQuery) : change.content.slice(1)}
              </span>
            </div>
          );
        });
      })()}
    </div>
  );
}
