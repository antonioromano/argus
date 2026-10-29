/* Density (plan 008) — one table for every row-rhythm number that density
 * changes. DensityProvider writes the CSS half onto <html>; virtualised lists
 * (FileTreeView, CsvPreview), the sidebar's default width and the traffic-light
 * placement read the same numbers through useDensity(), so CSS and JS cannot
 * drift. Type sizes, --ctl-h-* hit targets, terminal and Monaco metrics never
 * change with density. tokens.css carries the Default values for surfaces that
 * render with no provider (/mobile, tests); density.test.ts pins the two. */
import type { Density } from '@argus/shared';

export interface DensityMetrics {
  /** --row-h: the Phase-1 row-height token this density binds. */
  rowH: string;
  /** --row-pad-y: sidebar navigation rows. */
  rowPadY: number;
  /** --leaf-pad-y: session-tree leaves. */
  leafPadY: number;
  /** --group-h: session-tree group header (min-height). */
  groupH: number;
  /** --header-pad-y: shell tile header. */
  headerPadY: number;
  /** --h-titlebar: toolbar height; the traffic lights centre on it. */
  titlebarH: number;
  /** --h-statusbar: the app status bar along the bottom (plan 009). */
  statusbarH: number;
  /** --w-sidebar: sidebar width until the user drags it. */
  sidebarW: number;
  /** File-tree virtual row at the default interface font. */
  treeRowH: number;
  /** CSV preview virtual row. */
  csvRowH: number;
}

export const DENSITY_METRICS: Record<Density, DensityMetrics> = {
  compact: {
    rowH: 'var(--row-h-compact)', rowPadY: 4, leafPadY: 2, groupH: 22, headerPadY: 2,
    titlebarH: 38, statusbarH: 20, sidebarW: 200, treeRowH: 20, csvRowH: 24,
  },
  default: {
    rowH: 'var(--ctl-h-md)', rowPadY: 6, leafPadY: 4, groupH: 26, headerPadY: 4,
    titlebarH: 44, statusbarH: 22, sidebarW: 220, treeRowH: 22, csvRowH: 28,
  },
  comfortable: {
    rowH: 'var(--row-h-comfortable)', rowPadY: 8, leafPadY: 6, groupH: 30, headerPadY: 6,
    titlebarH: 52, statusbarH: 26, sidebarW: 220, treeRowH: 26, csvRowH: 32,
  },
};

export const DEFAULT_DENSITY: Density = 'default';

export function isDensity(v: unknown): v is Density {
  return v === 'compact' || v === 'default' || v === 'comfortable';
}

/** The CSS custom properties DensityProvider sets on <html>. */
export function densityCssVars(m: DensityMetrics): Record<string, string> {
  return {
    '--row-h': m.rowH,
    '--row-pad-y': `${m.rowPadY}px`,
    '--leaf-pad-y': `${m.leafPadY}px`,
    '--group-h': `${m.groupH}px`,
    '--header-pad-y': `${m.headerPadY}px`,
    '--h-titlebar': `${m.titlebarH}px`,
    '--h-statusbar': `${m.statusbarH}px`,
    '--w-sidebar': `${m.sidebarW}px`,
  };
}
