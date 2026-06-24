import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Papa from 'papaparse';

interface CsvPreviewProps {
  source: string;
}

const ROW_HEIGHT = 28;

interface ParsedCsv {
  header: string[];
  rows: string[][];
  error: string | null;
}

function parseCsv(source: string): ParsedCsv {
  const result = Papa.parse<string[]>(source, { skipEmptyLines: 'greedy' });
  const data = (result.data as string[][]) ?? [];
  const [header, ...rows] = data;
  const error = result.errors.length > 0 ? result.errors[0]?.message ?? 'Parse error' : null;
  return { header: header ?? [], rows, error };
}

export function CsvPreview({ source }: CsvPreviewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { header, rows, error } = useMemo(() => parseCsv(source), [source]);

  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual is not React-Compiler-compatible
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (source.trim() === '') {
    return (
      <div className="argus-csv-preview-empty" style={emptyStyle}>
        Empty file
      </div>
    );
  }

  const colCount = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const cols = Array.from({ length: colCount });

  return (
    <div ref={parentRef} className="argus-scroll argus-csv-preview" style={containerStyle}>
      {error && (
        <div style={errorBannerStyle}>{error} · showing parsed rows</div>
      )}
      <table style={tableStyle}>
        <thead style={{ display: 'block' }}>
          <tr style={rowStyle}>
            <th style={{ ...thStyle, ...rowNumCellStyle }} aria-label="row number" />
            {cols.map((_, c) => (
              <th key={c} style={thStyle} title={header[c] ?? ''}>
                {header[c] ?? ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody style={{ position: 'relative', display: 'block', height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const row = rows[vRow.index];
            return (
              <tr
                key={vRow.index}
                style={{
                  ...rowStyle,
                  position: 'absolute',
                  top: vRow.start,
                  left: 0,
                  height: ROW_HEIGHT,
                }}
              >
                <td style={{ ...tdStyle, ...rowNumCellStyle }}>{vRow.index + 1}</td>
                {cols.map((_, c) => (
                  <td key={c} style={tdStyle} title={row[c] ?? ''}>
                    {row[c] ?? ''}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: 'auto',
  background: 'var(--bg-0)',
  color: 'var(--fg-1)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-xs)',
};

const emptyStyle: React.CSSProperties = {
  ...containerStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--fg-3)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--t-sm)',
};

const errorBannerStyle: React.CSSProperties = {
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
  width: '100%',
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
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const tdStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderBottom: '1px solid var(--line-2)',
  borderRight: '1px solid var(--line-2)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const rowNumCellStyle: React.CSSProperties = {
  width: 52,
  color: 'var(--fg-3)',
  textAlign: 'right',
  background: 'var(--bg-1)',
};
