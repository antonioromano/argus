import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { File as DiffFile, Chunk, Change } from 'parse-diff';
import { segmentChangeBlocks, type ChangeBlock } from './diff/changeBlocks.js';
import { BlockGutterCell } from './diff/BlockGutterCell.js';
import { diffNavHandlers, type DiffNav } from './diff/diffSymbolNav.js';

const GUTTER = 34;
const BLOCK_GUTTER_W = 50;
const ROW_LH = 1.6;

export interface SplitDiffSelectionProps {
  filePath: string;
  isChecked: (filePath: string, hash: string) => boolean;
  onToggle: (block: ChangeBlock) => void;
  onRevert: (block: ChangeBlock) => Promise<void> | void;
}

export interface SplitDiffEditProps {
  editLine: (lineNo: number, text: string) => void;
}

type Seg =
  | { type: 'ctx'; change: Change }
  | { type: 'change'; dels: Change[]; adds: Change[] };

interface Block {
  rowStart: number;
  dN: number;
  aN: number;
}

function segment(changes: Change[]): Seg[] {
  const segs: Seg[] = [];
  let dels: Change[] = [];
  let adds: Change[] = [];
  const flush = () => {
    if (dels.length || adds.length) {
      segs.push({ type: 'change', dels, adds });
      dels = [];
      adds = [];
    }
  };
  for (const c of changes) {
    if (c.type === 'del') dels.push(c);
    else if (c.type === 'add') adds.push(c);
    else {
      flush();
      segs.push({ type: 'ctx', change: c });
    }
  }
  flush();
  return segs;
}

function lineText(c: Change): string {
  return c.content.replace(/^[+\- ]/, '');
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  height: `${ROW_LH}em`,
  lineHeight: ROW_LH,
};
const lnStyle: React.CSSProperties = {
  width: 46,
  flex: 'none',
  textAlign: 'right',
  padding: '0 8px',
  color: 'var(--fg-3)',
  userSelect: 'none',
  background: 'var(--bg-1)',
};
const markStyle: React.CSSProperties = { width: 16, flex: 'none', textAlign: 'center' };
const codeStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  whiteSpace: 'pre',
  overflow: 'visible',
  paddingRight: 8,
};

function DelRow({ c, nav }: { c: Change; nav?: DiffNav | null }) {
  const ln = (c as Change & { ln?: number }).ln;
  const { handlers, cursor } = diffNavHandlers(nav, ln);
  return (
    <div style={{ ...rowStyle, background: 'var(--diff-del)', color: 'var(--diff-del-fg)' }}>
      <div style={{ ...lnStyle, background: 'transparent' }}>{ln}</div>
      <div style={{ ...markStyle, color: 'var(--diff-del-tok)' }}>−</div>
      <div {...handlers} style={{ ...codeStyle, cursor }}>{lineText(c)}</div>
    </div>
  );
}

function EditableCode({
  text,
  lineNo,
  editLine,
}: {
  text: string;
  lineNo: number | undefined;
  editLine: (lineNo: number, text: string) => void;
}) {
  if (lineNo == null) return <span>{text}</span>;
  return (
    <span
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={(e) => {
        editLine(lineNo, (e.currentTarget.textContent ?? '').replace(/\n/g, ''));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.preventDefault();
      }}
      style={{ outline: 'none', display: 'inline-block', minWidth: 1 }}
    >
      {text}
    </span>
  );
}

function AddRow({ c, edit, nav }: { c: Change; edit?: SplitDiffEditProps; nav?: DiffNav | null }) {
  const ln = (c as Change & { ln?: number }).ln;
  const { handlers, cursor } = diffNavHandlers(nav, ln);
  return (
    <div style={{ ...rowStyle, background: 'var(--diff-add)', color: 'var(--diff-add-fg)' }}>
      <div style={{ ...lnStyle, background: 'transparent' }}>{ln}</div>
      <div style={{ ...markStyle, color: 'var(--diff-add-tok)' }}>+</div>
      <div {...handlers} style={{ ...codeStyle, cursor }}>
        {edit ? (
          <EditableCode text={lineText(c)} lineNo={ln} editLine={edit.editLine} />
        ) : (
          lineText(c)
        )}
      </div>
    </div>
  );
}

function CtxRow({
  c,
  side,
  edit,
  nav,
}: {
  c: Change;
  side: 'l' | 'r';
  edit?: SplitDiffEditProps;
  nav?: DiffNav | null;
}) {
  const n = side === 'l' ? (c as Change & { ln1?: number }).ln1 : (c as Change & { ln2?: number }).ln2;
  const editable = edit && side === 'r' && n != null;
  const { handlers, cursor } = diffNavHandlers(nav, n);
  return (
    <div style={{ ...rowStyle, color: 'var(--fg-1)' }}>
      <div style={lnStyle}>{n}</div>
      <div style={{ ...markStyle, color: 'var(--fg-4)' }} />
      <div {...handlers} style={{ ...codeStyle, cursor }}>
        {editable ? (
          <EditableCode text={lineText(c)} lineNo={n} editLine={edit.editLine} />
        ) : (
          lineText(c)
        )}
      </div>
    </div>
  );
}

function FillRow() {
  return (
    <div style={{ ...rowStyle, background: 'var(--bg-0)' }}>
      <div style={{ ...lnStyle, color: 'transparent' }} />
      <div style={markStyle} />
      <div style={codeStyle} />
    </div>
  );
}

function ChunkSplit({
  chunk,
  chunkIndex,
  selection,
  edit,
  nav,
}: {
  chunk: Chunk;
  chunkIndex: number;
  selection?: SplitDiffSelectionProps;
  edit?: SplitDiffEditProps;
  nav?: DiffNav | null;
}) {
  const uid = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<Array<{ d: string; id: string }>>([]);

  const { segs, blocks, changeBlocks } = useMemo(() => {
    const segs = segment(chunk.changes);
    const blocks: Block[] = [];
    let rowIdx = 0;
    for (const s of segs) {
      if (s.type === 'ctx') rowIdx += 1;
      else {
        blocks.push({ rowStart: rowIdx, dN: s.dels.length, aN: s.adds.length });
        rowIdx += Math.max(s.dels.length, s.adds.length);
      }
    }
    const changeBlocks = selection
      ? segmentChangeBlocks(selection.filePath, chunkIndex, chunk)
      : [];
    return { segs, blocks, changeBlocks };
  }, [chunk, chunkIndex, selection]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    const gutter = gutterRef.current;
    if (!grid || !left || !right || !gutter) return;

    const measure = () => {
      const base = grid.getBoundingClientRect();
      const lrows = left.children;
      const rrows = right.children;
      const gutterRect = gutter.getBoundingClientRect();
      const x1 = gutterRect.left - base.left;
      const x2 = gutterRect.right - base.left;
      const cx = (x1 + x2) / 2;
      const next: Array<{ d: string; id: string }> = [];
      blocks.forEach((b, i) => {
        if (b.dN === 0 && b.aN === 0) return;
        const topEl = (lrows[b.rowStart] ?? rrows[b.rowStart]) as HTMLElement | undefined;
        if (!topEl) return;
        const topY = topEl.getBoundingClientRect().top - base.top;
        const lBottomEl = b.dN > 0 ? (lrows[b.rowStart + b.dN - 1] as HTMLElement) : null;
        const rBottomEl = b.aN > 0 ? (rrows[b.rowStart + b.aN - 1] as HTMLElement) : null;
        const lBot = lBottomEl ? lBottomEl.getBoundingClientRect().bottom - base.top : topY;
        const rBot = rBottomEl ? rBottomEl.getBoundingClientRect().bottom - base.top : topY;
        next.push({
          id: `${uid.replace(/:/g, '')}g${i}`,
          d: `M ${x1} ${topY} L ${x2} ${topY} L ${x2} ${rBot} C ${cx} ${rBot}, ${cx} ${lBot}, ${x1} ${lBot} Z`,
        });
      });
      setPaths(next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [blocks, uid]);

  let rowKey = 0;
  let blockCursor = 0;
  const leftRows: React.ReactNode[] = [];
  const rightRows: React.ReactNode[] = [];
  const gutterRows: React.ReactNode[] = [];
  for (const s of segs) {
    if (s.type === 'ctx') {
      leftRows.push(<CtxRow key={rowKey} c={s.change} side="l" nav={nav} />);
      rightRows.push(<CtxRow key={rowKey} c={s.change} side="r" edit={edit} nav={nav} />);
      if (selection) gutterRows.push(<BlockGutterCell key={rowKey} block={null} isChecked={false} onToggle={() => {}} onRevert={() => {}} />);
      rowKey += 1;
    } else {
      const h = Math.max(s.dels.length, s.adds.length);
      const blk = selection ? changeBlocks[blockCursor] : null;
      for (let k = 0; k < h; k++) {
        leftRows.push(k < s.dels.length ? <DelRow key={rowKey} c={s.dels[k]} nav={nav} /> : <FillRow key={rowKey} />);
        rightRows.push(k < s.adds.length ? <AddRow key={rowKey} c={s.adds[k]} edit={edit} nav={nav} /> : <FillRow key={rowKey} />);
        if (selection) {
          const isFirstRow = k === 0;
          gutterRows.push(
            <BlockGutterCell
              key={rowKey}
              block={isFirstRow ? blk ?? null : null}
              isChecked={isFirstRow && blk ? selection.isChecked(selection.filePath, blk.hash) : false}
              onToggle={selection.onToggle}
              onRevert={selection.onRevert}
            />,
          );
        }
        rowKey += 1;
      }
      blockCursor += 1;
    }
  }

  return (
    <div style={{ marginBottom: 'var(--s-4)', border: '1px solid var(--line-2)', borderRadius: 6, overflow: 'hidden', fontFamily: 'var(--font-mono)', fontSize: 'var(--code-font-size, 13px)' }}>
      <div style={{ color: 'var(--fg-3)', padding: '3px 10px', background: 'var(--bg-1)' }}>{chunk.content}</div>
      <div
        ref={gridRef}
        style={{
          position: 'relative',
          display: 'flex',
          background: 'var(--bg-0)',
        }}
      >
        {selection && <div style={{ width: BLOCK_GUTTER_W, flexShrink: 0 }}>{gutterRows}</div>}
        <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
          <div ref={leftRef} style={{ minWidth: 'max-content' }}>{leftRows}</div>
        </div>
        <div
          ref={gutterRef}
          style={{ width: GUTTER, flexShrink: 0, background: 'var(--bg-1)', borderLeft: '1px solid var(--line-2)', borderRight: '1px solid var(--line-2)' }}
        />
        <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
          <div ref={rightRef} style={{ minWidth: 'max-content' }}>{rightRows}</div>
        </div>
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
        >
          <defs>
            {paths.map((p) => (
              <linearGradient key={p.id} id={p.id} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="var(--diff-del-tok)" stopOpacity="0.55" />
                <stop offset="1" stopColor="var(--diff-add-tok)" stopOpacity="0.55" />
              </linearGradient>
            ))}
          </defs>
          {paths.map((p) => (
            <path key={p.id} d={p.d} fill={`url(#${p.id})`} />
          ))}
        </svg>
      </div>
    </div>
  );
}

export function SplitDiff({
  target,
  selection,
  edit,
  nav,
}: {
  target: DiffFile;
  selection?: SplitDiffSelectionProps;
  edit?: SplitDiffEditProps;
  nav?: DiffNav | null;
}) {
  return (
    <>
      {target.chunks.map((chunk, i) => (
        <ChunkSplit key={i} chunk={chunk} chunkIndex={i} selection={selection} edit={edit} nav={nav} />
      ))}
    </>
  );
}
