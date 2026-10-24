import type { FindInFilesFile } from '@argus/shared';

/** Split a preview into plain / highlighted segments from [start, end) ranges. */
export function splitHighlights(preview: string, ranges: [number, number][]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const start = Math.max(a, pos);
    const end = Math.min(b, preview.length);
    if (end <= start) continue;
    if (start > pos) out.push({ text: preview.slice(pos, start), hit: false });
    out.push({ text: preview.slice(start, end), hit: true });
    pos = end;
  }
  if (pos < preview.length) out.push({ text: preview.slice(pos), hit: false });
  return out;
}

export type Row = { kind: 'file'; fi: number } | { kind: 'match'; fi: number; mi: number };

/** Flatten grouped results into keyboard-navigable rows; collapsed files hide their matches. */
export function flattenRows(files: FindInFilesFile[], collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  files.forEach((f, fi) => {
    rows.push({ kind: 'file', fi });
    if (!collapsed.has(f.path)) f.matches.forEach((_, mi) => rows.push({ kind: 'match', fi, mi }));
  });
  return rows;
}
