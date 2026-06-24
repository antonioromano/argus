import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import Papa from 'papaparse';

interface CsvPreviewProps {
  source: string;
}

const ROW_HEIGHT = 28;
const ROW_NUM_WIDTH = 52;
const MIN_COL = 64;
const MAX_COL = 480;
const CELL_PAD = 24; // horizontal padding budget (10px each side + buffer)
const MEASURE_ROWS = 300; // sample size for column-width measurement

interface ParsedCsv {
  header: string[];
  rows: string[][];
  error: string | null;
}

interface Match {
  row: number; // -1 == header
  col: number;
}

function parseCsv(source: string): ParsedCsv {
  const result = Papa.parse<string[]>(source, { skipEmptyLines: 'greedy' });
  const data = (result.data as string[][]) ?? [];
  const [header, ...rows] = data;
  const error = result.errors.length > 0 ? result.errors[0]?.message ?? 'Parse error' : null;
  return { header: header ?? [], rows, error };
}

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  const canvas = document.createElement('canvas');
  measureCtx = canvas.getContext('2d');
  return measureCtx;
}

function resolveFont(): string {
  const root = getComputedStyle(document.documentElement);
  const family = root.getPropertyValue('--font-mono').trim() || 'monospace';
  const size = root.getPropertyValue('--t-xs').trim() || '12px';
  return `${size} ${family}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

interface Layout {
  colWidths: number[];
  colOffsets: number[]; // left edge of each column inside the scroll area
  totalWidth: number;
}

function measureLayout(header: string[], rows: string[][], colCount: number): Layout {
  const ctx = getMeasureCtx();
  const widths = new Array<number>(colCount).fill(0);
  if (ctx) {
    ctx.font = resolveFont();
    const consider = (text: string, c: number) => {
      const w = ctx.measureText(text).width;
      if (w > widths[c]!) widths[c] = w;
    };
    for (let c = 0; c < colCount; c++) consider(header[c] ?? '', c);
    const sample = Math.min(rows.length, MEASURE_ROWS);
    for (let i = 0; i < sample; i++) {
      const row = rows[i]!;
      for (let c = 0; c < colCount; c++) consider(row[c] ?? '', c);
    }
  } else {
    // No canvas: fall back to a character-count heuristic.
    for (let c = 0; c < colCount; c++) {
      let max = (header[c] ?? '').length;
      const sample = Math.min(rows.length, MEASURE_ROWS);
      for (let i = 0; i < sample; i++) max = Math.max(max, (rows[i]![c] ?? '').length);
      widths[c] = max * 7;
    }
  }
  const colWidths = widths.map((w) => clamp(Math.ceil(w + CELL_PAD), MIN_COL, MAX_COL));
  const colOffsets: number[] = [];
  let acc = ROW_NUM_WIDTH;
  for (let c = 0; c < colCount; c++) {
    colOffsets[c] = acc;
    acc += colWidths[c]!;
  }
  return { colWidths, colOffsets, totalWidth: acc };
}

export function CsvPreview({ source }: CsvPreviewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { header, rows, error } = useMemo(() => parseCsv(source), [source]);

  const [fitToScreen, setFitToScreen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);

  const colCount = Math.max(header.length, ...rows.map((r) => r.length), 1);

  const layout = useMemo(
    () => measureLayout(header, rows, colCount),
    [header, rows, colCount],
  );

  const matches = useMemo<Match[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const res: Match[] = [];
    for (let c = 0; c < colCount; c++) {
      if ((header[c] ?? '').toLowerCase().includes(q)) res.push({ row: -1, col: c });
    }
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      for (let c = 0; c < colCount; c++) {
        if ((row[c] ?? '').toLowerCase().includes(q)) res.push({ row: r, col: c });
      }
    }
    return res;
  }, [query, header, rows, colCount]);

  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual is not React-Compiler-compatible
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Reset to the first hit whenever the query changes.
  useEffect(() => {
    setActiveMatch(0);
  }, [query]);

  // Bring the active match into view (vertically, and horizontally in full mode).
  useEffect(() => {
    if (!matches.length) return;
    const m = matches[Math.min(activeMatch, matches.length - 1)];
    if (!m) return;
    const el = parentRef.current;
    if (m.row === -1) {
      if (el) el.scrollTop = 0;
    } else {
      virtualizer.scrollToIndex(m.row, { align: 'center' });
    }
    if (!fitToScreen && el) {
      const left = layout.colOffsets[m.col] ?? 0;
      const right = left + (layout.colWidths[m.col] ?? 0);
      if (left < el.scrollLeft) el.scrollLeft = left - 8;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + 8;
    }
  }, [activeMatch, matches, fitToScreen, layout, virtualizer]);

  // ⌘F / Ctrl+F opens the find bar; Esc closes it. Scoped to the visible instance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = parentRef.current;
      if (!el || el.offsetParent === null) return; // hidden tab → ignore
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setFindOpen(true);
        requestAnimationFrame(() => inputRef.current?.select());
      } else if (e.key === 'Escape' && findOpen) {
        e.preventDefault();
        e.stopPropagation();
        setFindOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [findOpen]);

  if (source.trim() === '') {
    return (
      <div className="argus-csv-preview-empty" style={emptyStyle}>
        Empty file
      </div>
    );
  }

  const cols = Array.from({ length: colCount });
  const q = query.trim();
  const activeCell = matches[Math.min(activeMatch, Math.max(0, matches.length - 1))];

  const go = (delta: number) => {
    if (!matches.length) return;
    setActiveMatch((a) => (a + delta + matches.length) % matches.length);
  };

  const dynRowStyle: React.CSSProperties = fitToScreen
    ? { ...rowStyle, width: '100%' }
    : { ...rowStyle, width: layout.totalWidth };

  const cellWidth = (c: number): React.CSSProperties =>
    fitToScreen ? {} : { width: layout.colWidths[c], minWidth: layout.colWidths[c] };

  const clip = fitToScreen ? clipFit : clipFull;

  return (
    <div style={wrapperStyle}>
      <div style={toolbarStyle}>
        <label style={checkboxLabelStyle}>
          <input
            type="checkbox"
            checked={fitToScreen}
            onChange={(e) => setFitToScreen(e.target.checked)}
            style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
          Fit to screen
        </label>
        <div style={findGroupStyle}>
          <Search size={11} strokeWidth={1.8} style={{ color: 'var(--fg-3)' }} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Find"
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFindOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                go(e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setFindOpen(false);
                inputRef.current?.blur();
              }
            }}
            style={findInputStyle}
          />
          <span style={counterStyle}>
            {q ? `${matches.length ? activeMatch + 1 : 0}/${matches.length}` : ' '}
          </span>
          <button
            type="button"
            aria-label="Previous match"
            disabled={!matches.length}
            onClick={() => go(-1)}
            style={navBtnStyle(!matches.length)}
          >
            <ChevronUp size={12} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            aria-label="Next match"
            disabled={!matches.length}
            onClick={() => go(1)}
            style={navBtnStyle(!matches.length)}
          >
            <ChevronDown size={12} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      {error && <div style={errorBannerStyle}>{error} · showing parsed rows</div>}
      <div ref={parentRef} className="argus-scroll argus-csv-preview" style={scrollStyle}>
        <table style={tableStyle}>
          <thead style={{ display: 'block' }}>
            <tr style={dynRowStyle}>
              <th style={{ ...thStyle, ...clip, ...rowNumCellStyle }} aria-label="row number" />
              {cols.map((_, c) => {
                const isActive = !!findOpen && activeCell?.row === -1 && activeCell.col === c;
                return (
                  <th key={c} style={{ ...thStyle, ...clip, ...cellWidth(c) }} title={header[c] ?? ''}>
                    {highlight(header[c] ?? '', findOpen ? q : '', isActive)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody style={{ position: 'relative', display: 'block', height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const row = rows[vRow.index]!;
              return (
                <tr
                  key={vRow.index}
                  style={{
                    ...dynRowStyle,
                    position: 'absolute',
                    top: vRow.start,
                    left: 0,
                    height: ROW_HEIGHT,
                  }}
                >
                  <td style={{ ...tdStyle, ...clip, ...rowNumCellStyle }}>{vRow.index + 1}</td>
                  {cols.map((_, c) => {
                    const isActive =
                      !!findOpen && activeCell?.row === vRow.index && activeCell.col === c;
                    return (
                      <td key={c} style={{ ...tdStyle, ...clip, ...cellWidth(c) }} title={row[c] ?? ''}>
                        {highlight(row[c] ?? '', findOpen ? q : '', isActive)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function highlight(text: string, query: string, active: boolean): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  let idx = lower.indexOf(q, i);
  if (idx === -1) return text;
  while (idx !== -1) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={key++} style={active ? activeMarkStyle : markStyle}>
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
    idx = lower.indexOf(q, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}

const wrapperStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-0)',
};

const scrollStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: 'auto',
  background: 'var(--bg-0)',
  color: 'var(--fg-1)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-xs)',
};

const toolbarStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--s-2)',
  padding: '4px var(--s-3)',
  background: 'var(--bg-1)',
  borderBottom: '1px solid var(--line-2)',
  height: 32,
  boxSizing: 'border-box',
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  color: 'var(--fg-2)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-tiny)',
  letterSpacing: 'var(--tracking-eye)',
  userSelect: 'none',
};

const findGroupStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 6px',
  borderRadius: 'var(--r-2)',
  border: '1px solid var(--line-2)',
  background: 'var(--bg-2)',
};

const findInputStyle: React.CSSProperties = {
  all: 'unset',
  width: 120,
  color: 'var(--fg-1)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-tiny)',
};

const counterStyle: React.CSSProperties = {
  minWidth: 34,
  textAlign: 'right',
  color: 'var(--fg-3)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-tiny)',
  fontVariantNumeric: 'tabular-nums',
};

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    all: 'unset',
    cursor: disabled ? 'default' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    color: disabled ? 'var(--fg-3)' : 'var(--fg-1)',
    opacity: disabled ? 0.4 : 1,
  };
}

const emptyStyle: React.CSSProperties = {
  ...scrollStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--fg-3)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--t-sm)',
};

const errorBannerStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '4px 10px',
  fontSize: 'var(--t-xs)',
  color: 'var(--fg-3)',
  background: 'var(--bg-2)',
  borderBottom: '1px solid var(--line-2)',
};

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  display: 'block',
};

// Header row and each virtualized body row are independent display:table
// contexts; identical fixed layout + width keeps their columns aligned.
const rowStyle: React.CSSProperties = {
  display: 'table',
  tableLayout: 'fixed',
};

const thStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  textAlign: 'left',
  padding: '5px 10px',
  background: 'var(--bg-2)',
  color: 'var(--fg-0)',
  fontWeight: 600,
  borderBottom: '1px solid var(--line-1)',
  borderRight: '1px solid var(--line-2)',
};

const tdStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderBottom: '1px solid var(--line-2)',
  borderRight: '1px solid var(--line-2)',
};

// Fit mode: clip overflow with an ellipsis (current behavior).
const clipFit: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

// Full mode: column already sized to content; keep single-line, no ellipsis.
const clipFull: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
};

const rowNumCellStyle: React.CSSProperties = {
  width: ROW_NUM_WIDTH,
  minWidth: ROW_NUM_WIDTH,
  color: 'var(--fg-3)',
  textAlign: 'right',
  background: 'var(--bg-1)',
};

const markStyle: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--accent) 32%, transparent)',
  color: 'inherit',
  borderRadius: 2,
};

const activeMarkStyle: React.CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--bg-0)',
  borderRadius: 2,
};
