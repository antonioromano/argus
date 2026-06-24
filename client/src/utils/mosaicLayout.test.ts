import { describe, it, expect } from 'vitest';
import { mosaicLayout } from './mosaicLayout.js';

describe('mosaicLayout', () => {
  it('produces uniform grids for counts that tile cleanly', () => {
    expect(mosaicLayout(1)).toEqual({ cols: 1, rows: 1, rowSpans: [1] });
    expect(mosaicLayout(2)).toEqual({ cols: 2, rows: 1, rowSpans: [1, 1] });
    expect(mosaicLayout(3)).toEqual({ cols: 3, rows: 1, rowSpans: [1, 1, 1] });
    expect(mosaicLayout(6)).toEqual({ cols: 3, rows: 2, rowSpans: Array(6).fill(1) });
    expect(mosaicLayout(9)).toEqual({ cols: 3, rows: 3, rowSpans: Array(9).fill(1) });
    expect(mosaicLayout(12)).toEqual({ cols: 3, rows: 4, rowSpans: Array(12).fill(1) });
  });

  it('stretches a column taller to fill leftover space', () => {
    // col1 two stacked, cols 2&3 one full-height tile each
    expect(mosaicLayout(4)).toEqual({ cols: 3, rows: 2, rowSpans: [1, 1, 2, 2] });
    // cols 1&2 two stacked, col3 one full-height
    expect(mosaicLayout(5)).toEqual({ cols: 3, rows: 2, rowSpans: [1, 1, 1, 1, 2] });
    // col1 three tiles, cols 2&3 two taller tiles
    expect(mosaicLayout(7)).toEqual({ cols: 3, rows: 6, rowSpans: [2, 2, 2, 3, 3, 3, 3] });
    // cols 1&2 three tiles, col3 two taller tiles
    expect(mosaicLayout(8)).toEqual({ cols: 3, rows: 6, rowSpans: [2, 2, 2, 2, 2, 2, 3, 3] });
  });

  it('holds layout invariants for 1..12', () => {
    for (let n = 1; n <= 12; n++) {
      const { cols, rows, rowSpans } = mosaicLayout(n);

      // one span per tile
      expect(rowSpans.length).toBe(n);
      // capped column count
      expect(cols).toBe(Math.min(n, 3));

      // walk spans column by column (column-major): each column must sum to `rows`
      const colSizes: number[] = [];
      let acc = 0;
      let inCol = 0;
      for (const span of rowSpans) {
        acc += span;
        inCol += 1;
        expect(acc).toBeLessThanOrEqual(rows);
        if (acc === rows) {
          colSizes.push(inCol);
          acc = 0;
          inCol = 0;
        }
      }
      expect(acc).toBe(0); // every tile landed in a complete column
      expect(colSizes.length).toBe(cols);

      // balanced: column tile counts differ by at most 1, none exceeds ceil(n/3)
      expect(Math.max(...colSizes) - Math.min(...colSizes)).toBeLessThanOrEqual(1);
      expect(Math.max(...colSizes)).toBeLessThanOrEqual(Math.ceil(n / 3));
    }
  });

  it('handles the empty case without throwing', () => {
    expect(mosaicLayout(0)).toEqual({ cols: 1, rows: 0, rowSpans: [] });
  });
});
