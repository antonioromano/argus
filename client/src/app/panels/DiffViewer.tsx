import type { File as DiffFile } from 'parse-diff';
import { SplitDiff } from '../overlays/SplitDiff.js';
import { BlockGutterCell } from '../overlays/diff/BlockGutterCell.js';
import { type ChangeBlock, segmentChangeBlocks } from '../overlays/diff/changeBlocks.js';

export interface DiffViewerSelectionProps {
  isChecked: (filePath: string, hash: string) => boolean;
  toggle: (block: ChangeBlock) => void;
  revert: (block: ChangeBlock) => Promise<void> | void;
}

export interface DiffViewerEditProps {
  editLine: (lineNo: number, text: string) => void;
}

export interface DiffViewerEditStatus {
  saving: boolean;
  error: string | null;
}

function lineText(c: { content: string }): string {
  return c.content.replace(/^[+\- ]/, '');
}

/**
 * Renders a single parsed file's diff body in either split or unified mode.
 * Pure presentation — the parent (`FileSection`) owns the file header, collapse
 * state, and inline-edit lifecycle.
 */
export function DiffViewer({
  target,
  path,
  mode,
  selection,
  editProps,
  editStatus,
}: {
  target: DiffFile;
  path: string;
  mode: 'split' | 'unified';
  selection?: DiffViewerSelectionProps;
  editProps?: DiffViewerEditProps;
  editStatus?: DiffViewerEditStatus;
}) {
  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--code-font-size, 13px)' }}>
      {editStatus && (editStatus.saving || editStatus.error) && (
        <div
          className="eyebrow"
          style={{ color: 'var(--accent)', marginBottom: 'var(--s-3)', display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}
        >
          {editStatus.saving && <span style={{ color: 'var(--dirty)' }}>SAVING…</span>}
          {editStatus.error && <span style={{ color: 'var(--danger)' }}>· {editStatus.error}</span>}
        </div>
      )}
      {mode === 'split' ? (
        <SplitDiff
          target={target}
          selection={
            selection
              ? {
                  filePath: path,
                  isChecked: selection.isChecked,
                  onToggle: selection.toggle,
                  onRevert: selection.revert,
                }
              : undefined
          }
          edit={editProps}
        />
      ) : (
        target.chunks.map((chunk, i) => {
          const blocks = selection ? segmentChangeBlocks(path, i, chunk) : [];
          const blockByFirstChangeIdx = new Map<number, ChangeBlock>();
          if (selection) {
            // Map block.firstChangeIndex within chunk.changes (including ctx) to block.
            // Compute by walking chunk.changes alongside blocks.
            let nonCtx = 0;
            let blockCursor = 0;
            chunk.changes.forEach((c, idx) => {
              if (c.type === 'normal') return;
              const blk = blocks[blockCursor];
              if (blk && nonCtx === blk.changeIndicesInChunk[0]) {
                blockByFirstChangeIdx.set(idx, blk);
                blockCursor += 1;
              }
              nonCtx += 1;
            });
          }
          return (
          <div key={i} style={{ marginBottom: 'var(--s-4)' }}>
            <div style={{ color: 'var(--fg-3)', padding: '2px var(--s-2)', background: 'var(--bg-1)', borderRadius: 'var(--r-1)', marginBottom: 4 }}>
              {chunk.content}
            </div>
            {chunk.changes.map((c, j) => {
              const isAdd = c.type === 'add';
              const isDel = c.type === 'del';
              const block = selection ? blockByFirstChangeIdx.get(j) ?? null : null;
              const lineNo = isAdd
                ? (c as { ln?: number }).ln
                : isDel
                  ? undefined
                  : (c as { ln2?: number }).ln2;
              const canEdit = !!editProps && !isDel && lineNo != null;
              return (
                <div
                  key={j}
                  style={{
                    display: 'flex',
                    gap: 'var(--s-2)',
                    padding: '0 var(--s-2)',
                    background: isAdd ? 'var(--diff-add)' : isDel ? 'var(--diff-del)' : 'transparent',
                    color: isAdd ? 'var(--diff-add-fg)' : isDel ? 'var(--diff-del-fg)' : 'var(--fg-1)',
                    whiteSpace: 'pre',
                  }}
                >
                  {selection && (
                    <div style={{ width: 50, flexShrink: 0 }}>
                      <BlockGutterCell
                        block={block}
                        isChecked={block ? selection.isChecked(path, block.hash) : false}
                        onToggle={selection.toggle}
                        onRevert={selection.revert}
                      />
                    </div>
                  )}
                  <span style={{ width: 14, color: 'var(--fg-4)', flexShrink: 0 }}>
                    {isAdd ? '+' : isDel ? '−' : ' '}
                  </span>
                  {canEdit ? (
                    <span
                      contentEditable
                      suppressContentEditableWarning
                      spellCheck={false}
                      onInput={(e) => {
                        editProps!.editLine(lineNo as number, (e.currentTarget.textContent ?? '').replace(/\n/g, ''));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.preventDefault();
                      }}
                      style={{ outline: 'none', flex: 1, minWidth: 0 }}
                    >
                      {lineText(c)}
                    </span>
                  ) : (
                    <span>{lineText(c)}</span>
                  )}
                </div>
              );
            })}
          </div>
          );
        })
      )}
    </div>
  );
}
