import { useRef } from 'react';
import type { StructuredHunk, SideBySideLine, BlameResponse } from '@argus/shared';
import { DiffGutter } from './DiffGutter.js';
import { DiffHunkRow } from './DiffHunkRow.js';

interface SideBySideDiffPaneProps {
  hunks: StructuredHunk[];
  section: 'unstaged' | 'staged' | 'branch';
  hiddenHunkIndices?: Set<number>;
  searchQuery?: string;
  blameData?: BlameResponse | null;
  wordWrap?: boolean;
  contextLines: number;
  onExpandContext: () => void;
  onStageHunk?: (hunkIndex: number) => void;
  onDiscardHunk?: (hunkIndex: number) => void;
  onUnstageHunk?: (hunkIndex: number) => void;
  onCopyHunk?: (hunkIndex: number) => void;
}

/**
 * Side-by-side two-column diff viewer.
 *
 * Each hunk is rendered as a pair of synchronized columns (left = old/del,
 * right = new/add). Scroll position is kept in sync between the two panes
 * via a lightweight ref-based approach that avoids feedback loops.
 */
export function SideBySideDiffPane({
  hunks,
  section,
  hiddenHunkIndices,
  searchQuery,
  blameData,
  wordWrap,
  onExpandContext,
  onStageHunk,
  onDiscardHunk,
  onUnstageHunk,
  onCopyHunk,
}: SideBySideDiffPaneProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  // Guard flag prevents scroll-sync handlers from triggering each other
  const syncingRef = useRef(false);

  const syncScroll = (source: 'left' | 'right') => (e: React.UIEvent<HTMLDivElement>) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const el = e.target as HTMLDivElement;
    const target = source === 'left' ? rightRef.current : leftRef.current;
    if (target) {
      target.scrollTop = el.scrollTop;
      target.scrollLeft = el.scrollLeft;
    }
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  return (
    <div style={{ display: 'flex', overflow: 'hidden', flex: 1 }}>
      {/* Left pane — old content (del side) */}
      <div
        ref={leftRef}
        onScroll={syncScroll('left')}
        style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}
      >
        {hunks.map((hunk, hunkIndex) => {
          const isHidden = hiddenHunkIndices?.has(hunkIndex) ?? false;

          return (
            <div key={hunkIndex}>
              {/* Expand-context control between consecutive hunks */}
              {hunkIndex > 0 && (
                <div
                  onClick={onExpandContext}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px 12px',
                    background: 'var(--color-diff-hunk-bg)',
                    cursor: 'pointer',
                    userSelect: 'none',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-diff-hunk-text)',
                    borderTop: '1px solid rgba(128,128,128,0.15)',
                    borderBottom: '1px solid rgba(128,128,128,0.15)',
                    minHeight: '24px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                >
                  Show more context
                </div>
              )}

              {isHidden ? (
                // Collapsed hunk — render a fixed-height spacer so both panes stay aligned
                <div style={{ height: `${hunk.lines.length * 20}px` }} />
              ) : (
                <>
                  {/* Hunk header */}
                  <div
                    style={{
                      padding: '2px 8px',
                      background: 'var(--color-diff-hunk-bg)',
                      color: 'var(--color-diff-hunk-text)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      lineHeight: '20px',
                    }}
                  >
                    {hunk.header}
                  </div>

                  {/* Hunk lines — left (old) side */}
                  {hunk.lines.map((sideLine: SideBySideLine, lineIndex: number) => {
                    const isFirstLineOfHunk = lineIndex === 0;
                    const leftLine = sideLine.left;

                    // Blame is only relevant on the branch section and for the left (old) side
                    const blameEntry =
                      section === 'branch' && leftLine.lineNo != null
                        ? blameData?.lines.find((l) => l.lineNo === leftLine.lineNo)
                        : undefined;

                    return (
                      <div
                        key={lineIndex}
                        style={{ display: 'flex', alignItems: 'stretch' }}
                      >
                        <DiffGutter
                          oldLineNo={leftLine.lineNo}
                          newLineNo={null}
                          lineType={leftLine.type}
                          diffSection={section}
                          hunkIndex={hunkIndex}
                          isFirstLineOfHunk={isFirstLineOfHunk}
                          blameEntry={blameEntry}
                          onStageHunk={onStageHunk ? () => onStageHunk(hunkIndex) : undefined}
                          onDiscardHunk={onDiscardHunk ? () => onDiscardHunk(hunkIndex) : undefined}
                          onUnstageHunk={onUnstageHunk ? () => onUnstageHunk(hunkIndex) : undefined}
                          onCopyHunk={onCopyHunk ? () => onCopyHunk(hunkIndex) : undefined}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <DiffHunkRow
                            line={leftLine}
                            searchQuery={searchQuery}
                            wordWrap={wordWrap}
                          />
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Right pane — new content (add side) */}
      <div
        ref={rightRef}
        onScroll={syncScroll('right')}
        style={{
          flex: 1,
          overflowX: 'auto',
          overflowY: 'auto',
          borderLeft: '1px solid rgba(128,128,128,0.15)',
        }}
      >
        {hunks.map((hunk, hunkIndex) => {
          const isHidden = hiddenHunkIndices?.has(hunkIndex) ?? false;

          return (
            <div key={hunkIndex}>
              {/* Mirror the expand-context spacer so right pane heights match */}
              {hunkIndex > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px 12px',
                    background: 'var(--color-diff-hunk-bg)',
                    userSelect: 'none',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-diff-hunk-text)',
                    borderTop: '1px solid rgba(128,128,128,0.15)',
                    borderBottom: '1px solid rgba(128,128,128,0.15)',
                    minHeight: '24px',
                    // Right pane version is non-interactive; left pane owns the click
                    pointerEvents: 'none',
                  }}
                >
                  Show more context
                </div>
              )}

              {isHidden ? (
                <div style={{ height: `${hunk.lines.length * 20}px` }} />
              ) : (
                <>
                  {/* Mirror hunk header height exactly */}
                  <div
                    style={{
                      padding: '2px 8px',
                      background: 'var(--color-diff-hunk-bg)',
                      color: 'var(--color-diff-hunk-text)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      lineHeight: '20px',
                    }}
                  >
                    {hunk.header}
                  </div>

                  {/* Hunk lines — right (new) side */}
                  {hunk.lines.map((sideLine: SideBySideLine, lineIndex: number) => {
                    const isFirstLineOfHunk = lineIndex === 0;
                    const rightLine = sideLine.right;

                    return (
                      <div
                        key={lineIndex}
                        style={{ display: 'flex', alignItems: 'stretch' }}
                      >
                        <DiffGutter
                          oldLineNo={null}
                          newLineNo={rightLine.lineNo}
                          lineType={rightLine.type}
                          diffSection={section}
                          hunkIndex={hunkIndex}
                          isFirstLineOfHunk={isFirstLineOfHunk}
                          // Actions are only on the left gutter; right gutter is display-only
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <DiffHunkRow
                            line={rightLine}
                            searchQuery={searchQuery}
                            wordWrap={wordWrap}
                          />
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
