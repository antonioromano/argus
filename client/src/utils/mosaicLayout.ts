// Computes the mosaic grid geometry for a given number of active tiles so the
// grid always fills its space, absorbing leftover space VERTICALLY: a uniform
// grid when the count tiles cleanly (6 → 3×2, 9 → 3×3), and a taller column
// otherwise (5 → two 2-stacked columns + one full-height column).
//
// Tiles are distributed into balanced columns (fuller columns first, capped at
// `maxCols` wide). The grid uses LCM-of-column-sizes row tracks and gives each
// tile a `rowSpan`; with `grid-auto-flow: column` every column sums to exactly
// `rows`, so there are no holes and shorter columns get taller tiles.
//
// Tiles flow column-major: tile order runs top-to-bottom, then left-to-right.

export interface MosaicGridLayout {
  /** Number of equal fractional column tracks in the grid. */
  cols: number;
  /** Number of equal fractional row tracks in the grid. */
  rows: number;
  /** Row span for each tile, in column-major order (length === count). */
  rowSpans: number[];
}

function gcd(a: number, b: number): number {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

export function mosaicLayout(count: number, maxCols = 3): MosaicGridLayout {
  if (count <= 0) return { cols: 1, rows: 0, rowSpans: [] };

  const cols = Math.min(count, maxCols);
  const base = Math.floor(count / cols);
  const extra = count % cols; // first `extra` columns get one more tile

  const colSizes: number[] = [];
  for (let c = 0; c < cols; c++) colSizes.push(base + (c < extra ? 1 : 0));

  const rows = colSizes.reduce((acc, size) => lcm(acc, size), 1);

  const rowSpans: number[] = [];
  for (const size of colSizes) {
    const span = rows / size;
    for (let k = 0; k < size; k++) rowSpans.push(span);
  }

  return { cols, rows, rowSpans };
}
