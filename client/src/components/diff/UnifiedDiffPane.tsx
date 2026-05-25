import type { StructuredHunk, SideBySideLine, BlameResponse } from '@argus/shared';
import { DiffGutter } from './DiffGutter.js';
import { DiffHunkRow } from './DiffHunkRow.js';

interface UnifiedDiffPaneProps {
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
 * Single-pane unified diff viewer.
 *
 * Each SideBySideLine is flattened into one or two rows:
 *   - context line  → one row (left == right, render once)
 *   - del line      → one row (old/red)
 *   - add line      → one row (new/green)
 *   - spacer        → omitted (spacers are a side-by-side concept only)
 *
 * When both a del and add are present for the same SideBySideLine (i.e. an
 * in-place change), both rows are emitted: del first, then add.
 */
export function UnifiedDiffPane({
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
}: UnifiedDiffPaneProps) {
  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {hunks.map((hunk, hunkIndex) => {
        const isHidden = hiddenHunkIndices?.has(hunkIndex) ?? false;

        // Count the unified rows this hunk would produce (for hidden-height calc)
        const unifiedRowCount = isHidden
          ? hunk.lines.reduce((sum, sideLine) => {
              const leftType = sideLine.left.type;
              const rightType = sideLine.right.type;
              if (leftType === 'spacer') return sum;
              if (leftType === 'context') return sum + 1;
              // del and/or add rows
              return sum + (leftType === 'del' ? 1 : 0) + (rightType === 'add' ? 1 : 0);
            }, 0)
          : 0;

        return (
          <div key={hunkIndex}>
            {/* Expand-context control between consecutive visible hunks */}
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
              // Collapsed hunk placeholder
              <div style={{ height: `${unifiedRowCount * 20}px` }} />
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

                {/* Unified rows */}
                {hunk.lines.flatMap((sideLine: SideBySideLine, lineIndex: number) => {
                  const isFirstLineOfHunk = lineIndex === 0;
                  const { left, right } = sideLine;
                  const rows: React.ReactNode[] = [];

                  // Spacers are a side-by-side concept; skip them in unified mode
                  if (left.type === 'spacer') {
                    return rows;
                  }

                  if (left.type === 'context') {
                    // Context line — both sides are identical; render once using left
                    const blameEntry =
                      section === 'branch' && left.lineNo != null
                        ? blameData?.lines.find((l) => l.lineNo === left.lineNo)
                        : undefined;

                    rows.push(
                      <div
                        key={`ctx-${lineIndex}`}
                        style={{ display: 'flex', alignItems: 'stretch' }}
                      >
                        <DiffGutter
                          oldLineNo={left.lineNo}
                          newLineNo={right.lineNo}
                          lineType="context"
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
                            line={left}
                            searchQuery={searchQuery}
                            wordWrap={wordWrap}
                          />
                        </div>
                      </div>
                    );
                    return rows;
                  }

                  // del row (old content, red background)
                  if (left.type === 'del') {
                    rows.push(
                      <div
                        key={`del-${lineIndex}`}
                        style={{ display: 'flex', alignItems: 'stretch' }}
                      >
                        <DiffGutter
                          oldLineNo={left.lineNo}
                          newLineNo={null}
                          lineType="del"
                          diffSection={section}
                          hunkIndex={hunkIndex}
                          isFirstLineOfHunk={isFirstLineOfHunk && rows.length === 0}
                          onStageHunk={onStageHunk ? () => onStageHunk(hunkIndex) : undefined}
                          onDiscardHunk={onDiscardHunk ? () => onDiscardHunk(hunkIndex) : undefined}
                          onUnstageHunk={onUnstageHunk ? () => onUnstageHunk(hunkIndex) : undefined}
                          onCopyHunk={onCopyHunk ? () => onCopyHunk(hunkIndex) : undefined}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <DiffHunkRow
                            line={left}
                            searchQuery={searchQuery}
                            wordWrap={wordWrap}
                          />
                        </div>
                      </div>
                    );
                  }

                  // add row (new content, green background)
                  if (right.type === 'add') {
                    rows.push(
                      <div
                        key={`add-${lineIndex}`}
                        style={{ display: 'flex', alignItems: 'stretch' }}
                      >
                        <DiffGutter
                          oldLineNo={null}
                          newLineNo={right.lineNo}
                          lineType="add"
                          diffSection={section}
                          hunkIndex={hunkIndex}
                          isFirstLineOfHunk={isFirstLineOfHunk && rows.length === 0}
                          onStageHunk={onStageHunk ? () => onStageHunk(hunkIndex) : undefined}
                          onDiscardHunk={onDiscardHunk ? () => onDiscardHunk(hunkIndex) : undefined}
                          onUnstageHunk={onUnstageHunk ? () => onUnstageHunk(hunkIndex) : undefined}
                          onCopyHunk={onCopyHunk ? () => onCopyHunk(hunkIndex) : undefined}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <DiffHunkRow
                            line={right}
                            searchQuery={searchQuery}
                            wordWrap={wordWrap}
                          />
                        </div>
                      </div>
                    );
                  }

                  return rows;
                })}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
