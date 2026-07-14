import type { MouseEvent as ReactMouseEvent } from 'react';
import type { File as DiffFile } from 'parse-diff';
import { SplitDiff } from '../overlays/SplitDiff.js';
import { BlockGutterCell } from '../overlays/diff/BlockGutterCell.js';
import { type ChangeBlock, segmentChangeBlocks } from '../overlays/diff/changeBlocks.js';
import { isNavModifier, onDiffCodeClick, useNavModifierHeld } from '../overlays/diff/diffSymbolNav.js';

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
  navFilePath,
  onOpenInEditor,
  mode,
  selection,
  editProps,
  editStatus,
}: {
  target: DiffFile;
  path: string;
  /** Absolute path of this file, for cmd+click symbol resolution. */
  navFilePath?: string;
  /** Open a file in the Monaco editor at a line (cmd+click go-to-def). */
  onOpenInEditor?: (filePath: string, line?: number) => void;
  mode: 'split' | 'unified';
  selection?: DiffViewerSelectionProps;
  editProps?: DiffViewerEditProps;
  editStatus?: DiffViewerEditStatus;
}) {
  const navHeld = useNavModifierHeld();
  const nav =
    navFilePath && onOpenInEditor
      ? { filePath: navFilePath, held: navHeld, open: onOpenInEditor }
      : null;
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
          nav={nav}
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
              // Symbol nav uses the line the click lands on: new line for
              // add/ctx, old line for del (server uses it only to drop the self-hit).
              const navLine =
                isAdd || isDel ? (c as { ln?: number }).ln : (c as { ln2?: number }).ln2;
              const navProps = nav
                ? {
                    onMouseDown: (e: ReactMouseEvent) => {
                      if (isNavModifier(e)) e.preventDefault();
                    },
                    onClick: (e: ReactMouseEvent) =>
                      onDiffCodeClick(e, nav.filePath, navLine ?? 0, nav.open),
                  }
                : null;
              const navCursor = nav?.held ? { cursor: 'pointer' as const } : null;
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
                      {...(navProps ?? {})}
                      style={{ outline: 'none', flex: 1, minWidth: 0, ...(navCursor ?? {}) }}
                    >
                      {lineText(c)}
                    </span>
                  ) : (
                    <span {...(navProps ?? {})} style={navCursor ?? undefined}>
                      {lineText(c)}
                    </span>
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
