// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DENSITY_METRICS, densityCssVars } from './density.js';

const CSS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const decl = (name: string) =>
  new RegExp(`${name.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`).exec(CSS)?.[1].trim();

describe('density table', () => {
  it('tokens.css defaults equal the Default density (surfaces with no provider)', () => {
    for (const [name, value] of Object.entries(densityCssVars(DENSITY_METRICS.default))) {
      if (name === '--row-h') continue; // the Phase-1 binding itself, checked below
      expect(decl(name), name).toBe(value);
    }
    expect(decl('--row-h')).toBe(DENSITY_METRICS.default.rowH);
  });

  it('every number grows from Compact to Comfortable, except the sidebar which only Compact narrows', () => {
    const { compact: c, default: d, comfortable: f } = DENSITY_METRICS;
    for (const k of ['rowPadY', 'leafPadY', 'groupH', 'headerPadY', 'titlebarH', 'statusbarH', 'treeRowH', 'csvRowH'] as const) {
      expect(c[k], k).toBeLessThan(d[k]);
      expect(d[k], k).toBeLessThan(f[k]);
    }
    expect([c.sidebarW, d.sidebarW, f.sidebarW]).toEqual([200, 220, 220]);
  });

  it('binds --row-h to the Phase-1 row-height tokens', () => {
    expect(DENSITY_METRICS.compact.rowH).toBe('var(--row-h-compact)');
    expect(DENSITY_METRICS.comfortable.rowH).toBe('var(--row-h-comfortable)');
  });

  it('the panel header follows the tile header padding', () => {
    expect(decl('--h-panel-header')).toBe('calc(var(--ctl-h-sm) + 2 * var(--header-pad-y) + 1px)');
  });
});
