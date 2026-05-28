import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { File as DiffFile, Chunk, Change } from 'parse-diff';

const GUTTER = 34;
const ROW_LH = 1.6;

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
  overflow: 'hidden',
  paddingRight: 8,
};

function DelRow({ c }: { c: Change }) {
  const ln = (c as Change & { ln?: number }).ln;
  return (
    <div style={{ ...rowStyle, background: 'var(--diff-del)', color: 'var(--diff-del-fg)' }}>
      <div style={{ ...lnStyle, background: 'transparent' }}>{ln}</div>
      <div style={{ ...markStyle, color: 'var(--diff-del-tok)' }}>−</div>
      <div style={codeStyle}>{lineText(c)}</div>
    </div>
  );
}

function AddRow({ c }: { c: Change }) {
  const ln = (c as Change & { ln?: number }).ln;
  return (
    <div style={{ ...rowStyle, background: 'var(--diff-add)', color: 'var(--diff-add-fg)' }}>
      <div style={{ ...lnStyle, background: 'transparent' }}>{ln}</div>
      <div style={{ ...markStyle, color: 'var(--diff-add-tok)' }}>+</div>
      <div style={codeStyle}>{lineText(c)}</div>
    </div>
  );
}

function CtxRow({ c, side }: { c: Change; side: 'l' | 'r' }) {
  const n = side === 'l' ? (c as Change & { ln1?: number }).ln1 : (c as Change & { ln2?: number }).ln2;
  return (
    <div style={{ ...rowStyle, color: 'var(--fg-1)' }}>
      <div style={lnStyle}>{n}</div>
      <div style={{ ...markStyle, color: 'var(--fg-4)' }} />
      <div style={codeStyle}>{lineText(c)}</div>
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

function ChunkSplit({ chunk }: { chunk: Chunk }) {
  const uid = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<Array<{ d: string; id: string }>>([]);

  const { segs, blocks } = useMemo(() => {
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
    return { segs, blocks };
  }, [chunk]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!grid || !left || !right) return;

    const measure = () => {
      const base = grid.getBoundingClientRect();
      const lrows = left.children;
      const rrows = right.children;
      const x1 = left.getBoundingClientRect().right - base.left;
      const x2 = x1 + GUTTER;
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
  const leftRows: React.ReactNode[] = [];
  const rightRows: React.ReactNode[] = [];
  for (const s of segs) {
    if (s.type === 'ctx') {
      leftRows.push(<CtxRow key={rowKey} c={s.change} side="l" />);
      rightRows.push(<CtxRow key={rowKey} c={s.change} side="r" />);
      rowKey += 1;
    } else {
      const h = Math.max(s.dels.length, s.adds.length);
      for (let k = 0; k < h; k++) {
        leftRows.push(k < s.dels.length ? <DelRow key={rowKey} c={s.dels[k]} /> : <FillRow key={rowKey} />);
        rightRows.push(k < s.adds.length ? <AddRow key={rowKey} c={s.adds[k]} /> : <FillRow key={rowKey} />);
        rowKey += 1;
      }
    }
  }

  return (
    <div style={{ marginBottom: 'var(--s-4)', border: '1px solid var(--line-2)', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ color: 'var(--fg-3)', padding: '3px 10px', background: 'var(--bg-1)' }}>{chunk.content}</div>
      <div
        ref={gridRef}
        style={{ position: 'relative', display: 'grid', gridTemplateColumns: `1fr ${GUTTER}px 1fr`, background: 'var(--bg-0)' }}
      >
        <div ref={leftRef} style={{ minWidth: 0 }}>{leftRows}</div>
        <div style={{ background: 'var(--bg-1)', borderLeft: '1px solid var(--line-2)', borderRight: '1px solid var(--line-2)' }} />
        <div ref={rightRef} style={{ minWidth: 0 }}>{rightRows}</div>
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

export function SplitDiff({ target }: { target: DiffFile }) {
  return (
    <>
      {target.chunks.map((chunk, i) => (
        <ChunkSplit key={i} chunk={chunk} />
      ))}
    </>
  );
}
