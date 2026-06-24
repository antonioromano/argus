import parseDiff, { type File as DiffFile } from 'parse-diff';

export type DiffSource = 'unstaged' | 'staged' | 'untracked';

/**
 * One changed file, parsed exactly once. `parsed` is threaded straight into the
 * renderers and selection helpers so nothing downstream re-parses the (possibly
 * multi-file) raw diff blob — that re-parse was O(n²) once every file is mounted
 * in the continuous-scroll view.
 */
export interface FileModel {
  /** Stable identity used as React key and sidebar/section id: `${source}::${path}`. */
  id: string;
  path: string;
  /** Rename origin, only when it differs from `path`. */
  fromPath?: string;
  source: DiffSource;
  add: number;
  del: number;
  isNew: boolean;
  isDeleted: boolean;
  parsed: DiffFile;
}

function pathOf(f: DiffFile): string {
  return f.to && f.to !== '/dev/null' ? f.to : f.from ?? '?';
}

/** Parse one git diff group's raw text into models. Tolerant of empty/garbage input. */
export function modelsFromRaw(rawDiff: string, source: DiffSource): FileModel[] {
  if (!rawDiff || !rawDiff.trim()) return [];
  let files: DiffFile[];
  try {
    files = parseDiff(rawDiff);
  } catch {
    return [];
  }
  return files.map((parsed) => {
    const path = pathOf(parsed);
    const from = parsed.from;
    return {
      id: `${source}::${path}`,
      path,
      fromPath: from && from !== path && from !== '/dev/null' ? from : undefined,
      source,
      add: parsed.additions ?? 0,
      del: parsed.deletions ?? 0,
      isNew: parsed.new ?? false,
      isDeleted: parsed.deleted ?? false,
      parsed,
    };
  });
}

export interface DiffStats {
  /** Total change rows (add + del + context) across all chunks. */
  lines: number;
  chunks: number;
}

export function diffStats(parsed: DiffFile): DiffStats {
  let lines = 0;
  for (const c of parsed.chunks) lines += c.changes.length;
  return { lines, chunks: parsed.chunks.length };
}

/** Files this large start collapsed so they don't flood the DOM / SVG-connector work. */
export const AUTO_COLLAPSE_LINES = 800;
export const AUTO_COLLAPSE_CHUNKS = 40;

export function shouldAutoCollapse(parsed: DiffFile): boolean {
  const { lines, chunks } = diffStats(parsed);
  return lines > AUTO_COLLAPSE_LINES || chunks > AUTO_COLLAPSE_CHUNKS;
}

/**
 * Rough rendered pixel height for a collapsed/not-yet-mounted section body, used
 * to reserve scroll space so the scrollbar and scroll-to-section stay accurate.
 * Each change row ≈ 1.6em ≈ 21px at the 13px code font, plus per-chunk header chrome.
 */
const ROW_PX = 21;
const CHUNK_HEADER_PX = 28;

export function estimateBodyHeight(parsed: DiffFile): number {
  const { lines, chunks } = diffStats(parsed);
  return lines * ROW_PX + chunks * CHUNK_HEADER_PX;
}
