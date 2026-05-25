import { useState, useMemo, useEffect } from 'react';
import type parseDiff from 'parse-diff';
import { ChevronRight, FolderOpen } from 'lucide-react';
import { DiffHunk } from './DiffHunk.js';
import { DiffExpandRow } from './DiffExpandRow.js';
import { TriStateCheckbox, InlineIconLink } from './primitives/index.js';
import type { FileSelection, FileMeta, TriState } from '../hooks/useCommitMode.js';

const MAX_LINES_BEFORE_TRUNCATE = 500;

interface CommitModeFileSectionProps {
  fileSelection: FileSelection | undefined;
  fileMeta: FileMeta;
  fileTriState: TriState;
  onToggleFile: () => void;
  onToggleChunk: (chunkIndex: number, totalChanges: number) => void;
  onToggleLine: (chunkIndex: number, changeIndex: number) => void;
  onRevertChunk: (chunkIndex: number, totalChanges: number) => void;
  isNarrow: boolean; // narrow layout: file-level only
}

interface DiffFileSectionProps {
  file: parseDiff.File;
  theme: 'dark' | 'light';
  defaultExpanded: boolean;
  collapseAllKey?: number;
  searchQuery?: string;
  commitMode?: CommitModeFileSectionProps;
  forceShowFull?: boolean;
  wordWrap?: boolean;
  onRevertChunk?: (chunkIndex: number, totalChanges: number) => void;
  onOpenInExplorer?: () => void;
  onExpandContext?: () => void;
  isExpandLoading?: boolean;
}

export function DiffFileSection({ file, theme, defaultExpanded, collapseAllKey, searchQuery, commitMode, forceShowFull, wordWrap, onRevertChunk, onOpenInExplorer, onExpandContext, isExpandLoading }: DiffFileSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showFull, setShowFull] = useState(forceShowFull ?? false);

  useEffect(() => {
    if (collapseAllKey) setExpanded(false);
  }, [collapseAllKey]);

  useEffect(() => {
    if (forceShowFull) setShowFull(true);
  }, [forceShowFull]);

  const fileName = file.to === '/dev/null' ? file.from : file.to;
  const isBinary = file.chunks.length === 0 && (file.additions === 0 && file.deletions === 0);

  const totalLines = useMemo(
    () => file.chunks.reduce((sum, c) => sum + c.changes.length, 0),
    [file.chunks],
  );
  const isTruncated = !showFull && totalLines > MAX_LINES_BEFORE_TRUNCATE;
  const isNew = file.new;
  const isDeleted = file.deleted;
  const showExpand = !!onExpandContext && !isBinary && !isNew && !isDeleted && file.chunks.length > 0;

  return (
    <div
      style={{
        borderRadius: '6px',
        border: '1px solid var(--color-border-base)',
        overflow: 'hidden',
        marginBottom: '8px',
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          background: 'var(--color-bg-elevated)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {/* File-level checkbox in commit mode */}
        {commitMode && (
          <TriStateCheckbox
            checked={
              commitMode.fileTriState === 'all' ? true :
              commitMode.fileTriState === 'partial' ? 'indeterminate' :
              false
            }
            onChange={commitMode.onToggleFile}
            label={`Toggle ${fileName} selection`}
          />
        )}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            width: '12px',
            color: 'var(--color-text-muted)',
            transition: 'transform 0.14s ease',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          <ChevronRight size={12} strokeWidth={2} />
        </span>
        <span
          style={{
            fontSize: '12px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-primary)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.from && file.to && file.from !== file.to && file.from !== '/dev/null' && file.to !== '/dev/null'
            ? <>{file.from}<span style={{ color: 'var(--color-text-muted)' }}>{' → '}</span>{file.to}</>
            : (fileName || 'unknown')}
        </span>
        {onOpenInExplorer && (
          <InlineIconLink icon={FolderOpen} label="Open in Explorer" onClick={() => onOpenInExplorer()} />
        )}
        {isNew && (
          <span style={{ fontSize: '10px', color: 'var(--color-success)', fontWeight: 600 }}>NEW</span>
        )}
        {isDeleted && (
          <span style={{ fontSize: '10px', color: 'var(--color-error)', fontWeight: 600 }}>DELETED</span>
        )}
        <span style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          {file.additions > 0 && (
            <span style={{
              background: 'var(--color-diff-add-gutter)',
              color: 'var(--color-diff-add-text)',
              borderRadius: 4,
              padding: '0 5px',
              fontSize: 10,
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'var(--font-mono)',
            }}>+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span style={{
              background: 'var(--color-diff-del-gutter)',
              color: 'var(--color-diff-del-text)',
              borderRadius: 4,
              padding: '0 5px',
              fontSize: 10,
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'var(--font-mono)',
            }}>-{file.deletions}</span>
          )}
        </span>
      </div>
      {expanded && (
        <div style={{ overflow: 'auto' }}>
          {isBinary ? (
            <div
              style={{
                padding: '12px',
                fontSize: '12px',
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
              }}
            >
              Binary file changed
            </div>
          ) : (
            <>
              {commitMode?.isNarrow && (
                <div style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border-base)', fontStyle: 'italic' }}>
                  Widen panel for line-level selection
                </div>
              )}
              {file.chunks.map((chunk, i) => {
                if (isTruncated) {
                  let linesBefore = 0;
                  for (let j = 0; j < i; j++) {
                    linesBefore += file.chunks[j].changes.length;
                  }
                  if (linesBefore >= MAX_LINES_BEFORE_TRUNCATE) return null;
                }

                // Count add/del changes in this chunk for tri-state
                const totalChanges = chunk.changes.filter(c => c.type === 'add' || c.type === 'del').length;

                // Compute hidden lines above this hunk
                const elements = [];

                if (showExpand && i === 0 && chunk.newStart > 1) {
                  elements.push(
                    <DiffExpandRow
                      key={`expand-top-${i}`}
                      hiddenLines={chunk.newStart - 1}
                      onExpand={onExpandContext!}
                      isLoading={isExpandLoading}
                      theme={theme}
                      position="top"
                    />
                  );
                }

                if (showExpand && i > 0) {
                  const prevChunk = file.chunks[i - 1];
                  const prevEnd = prevChunk.newStart + prevChunk.newLines;
                  const gap = chunk.newStart - prevEnd;
                  if (gap > 0) {
                    elements.push(
                      <DiffExpandRow
                        key={`expand-between-${i}`}
                        hiddenLines={gap}
                        onExpand={onExpandContext!}
                        isLoading={isExpandLoading}
                        theme={theme}
                        position="between"
                      />
                    );
                  }
                }

                elements.push(
                  <DiffHunk
                    key={i}
                    chunk={chunk}
                    searchQuery={searchQuery}
                    commitMode={
                      commitMode && !commitMode.isNarrow
                        ? {
                            chunkIndex: i,
                            chunkSelection: commitMode.fileSelection?.get(i),
                            totalChanges,
                            onToggleChunk: () => commitMode.onToggleChunk(i, totalChanges),
                            onToggleLine: (ci) => commitMode.onToggleLine(i, ci),
                            onRevertChunk: () => commitMode.onRevertChunk(i, totalChanges),
                          }
                        : undefined
                    }
                    onRevertHunk={!commitMode && onRevertChunk ? () => onRevertChunk(i, totalChanges) : undefined}
                    wordWrap={wordWrap}
                  />
                );

                // Expand row after the last hunk
                if (showExpand && i === file.chunks.length - 1) {
                  // We don't know total file lines, so always show bottom expand
                  elements.push(
                    <DiffExpandRow
                      key={`expand-bottom-${i}`}
                      hiddenLines={0}
                      onExpand={onExpandContext!}
                      isLoading={isExpandLoading}
                      theme={theme}
                      position="bottom"
                    />
                  );
                }

                return elements;
              })}
              {isTruncated && (
                <div
                  style={{
                    padding: '8px 12px',
                    textAlign: 'center',
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowFull(true);
                    }}
                    style={{
                      padding: '4px 12px',
                      fontSize: '11px',
                      border: '1px solid var(--color-border-base)',
                      borderRadius: '4px',
                      background: 'transparent',
                      color: 'var(--color-accent)',
                      cursor: 'pointer',
                    }}
                  >
                    Show full diff ({totalLines} lines)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
