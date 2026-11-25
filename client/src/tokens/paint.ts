/* Argus OS — paint tokens.
 *
 * The few surfaces that are not painted by CSS — xterm.js (and the SwiftTerm
 * native overlay derived from it) and Monaco — take literal #RRGGBB strings, so
 * they cannot read `var(--…)`. Their colors live here instead of inline in each
 * component, mirrored from tokens.css. `tokens/contrast.test.ts` fails if a
 * mirrored value drifts from tokens.css or if any pair here drops below WCAG AA.
 */

import { derivedTheme, type PaletteId, type TerminalPalette } from './palettes.js';

export type ThemeName = 'dark' | 'light';

/** Mirrors of tokens.css surface tokens, for canvas/engine-painted surfaces. */
export const PAINT_SURFACES = {
  dark: {
    /** --bg-2: the tile card a terminal sits in (no seam around the cells). */
    terminal: '#191b20',
    /** --bg-inset: the code well; Monaco's `argus-dark` editor background. */
    inset: '#0a0b0d',
  },
  light: {
    terminal: '#ffffff',
    inset: '#efebe3',
  },
} as const satisfies Record<ThemeName, { terminal: string; inset: string }>;

/** Mirrors of --bg-1 / --bg-2 / --accent, for the system-accent contrast clamp
 *  (utils/focusAccent.ts), which runs before any stylesheet can be read. */
export const PAINT_ACCENT_SURFACES = {
  dark: { panel: '#131418', card: '#191b20', brand: '#FFB454' },
  light: { panel: '#ebe7dd', card: '#ffffff', brand: '#8C5300' },
} as const satisfies Record<ThemeName, { panel: string; card: string; brand: string }>;

/** Mirrors of the --syn-* tokens (+ --fg-1 body text), for Monaco's themes. */
export const PAINT_SYNTAX = {
  dark: { fg: '#c7cad1', kw: '#C5B4FC', str: '#7CFFB2', num: '#FFD23F', fn: '#7DD3FC', cm: '#868b98', pn: '#8b919c' },
  light: { fg: '#3a342a', kw: '#6E40B8', str: '#0C6E43', num: '#7F5912', fn: '#1562A9', cm: '#6d655b', pn: '#6a6258' },
} as const satisfies Record<ThemeName, Record<'fg' | 'kw' | 'str' | 'num' | 'fn' | 'cm' | 'pn', string>>;

/** Cell background a terminal paints, for the frame around it to match. */
export function terminalBackground(theme: ThemeName, palette: PaletteId = 'argus'): string {
  return palette === 'argus' ? PAINT_SURFACES[theme].terminal : paintFor(palette, theme).surfaces.terminal;
}

// Tokyo Night palette on the --bg-2 surface. brightBlack is what CLIs use for
// dim/secondary text (Claude's hints, git's context lines), so it is lifted
// from Tokyo Night's #414868 (1.9:1, unreadable) to clear 4.5:1.
export const TERMINAL_THEMES = {
  dark: {
    background: PAINT_SURFACES.dark.terminal,
    foreground: '#c0caf5',
    cursor: '#c0caf5',
    selectionBackground: '#33467c',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#7a82a8',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#c0caf5',
  },
  light: {
    background: PAINT_SURFACES.light.terminal,
    foreground: '#343b58',
    cursor: '#343b58',
    selectionBackground: '#b4d5fe',
    black: '#0f0f14',
    red: '#8c4351',
    green: '#485e30',
    yellow: '#8f5e15',
    blue: '#1e3a8a',
    magenta: '#5a4a78',
    cyan: '#0f4b6e',
    white: '#343b58',
    brightBlack: '#565f7c',
    brightRed: '#8c4351',
    brightGreen: '#485e30',
    brightYellow: '#8f5e15',
    brightBlue: '#1e3a8a',
    brightMagenta: '#5a4a78',
    brightCyan: '#0f4b6e',
    brightWhite: '#343b58',
  },
} as const;

export type TerminalTheme = (typeof TERMINAL_THEMES)[ThemeName];

/** xterm search-addon highlights (must be #RRGGBB). The addon only paints the
 *  cell background, so each must keep the theme foreground readable. */
export const TERMINAL_SEARCH_DECORATIONS = {
  dark: {
    matchBackground: '#34508f',
    matchOverviewRuler: '#34508f',
    activeMatchBackground: '#704e11',
    activeMatchColorOverviewRuler: '#e0af68',
  },
  light: {
    matchBackground: '#b4d5fe',
    matchOverviewRuler: '#3d59a1',
    activeMatchBackground: '#e0af68',
    activeMatchColorOverviewRuler: '#e0af68',
  },
} as const;

// ─── Color themes (tokens/palettes.ts) ───────────────────────────────────────

/** Everything an engine-painted surface needs for one theme and appearance. */
export interface Paint {
  surfaces: { terminal: string; inset: string };
  accent: { panel: string; card: string; brand: string };
  syntax: Record<'fg' | 'kw' | 'str' | 'num' | 'fn' | 'cm' | 'pn', string>;
  terminal: TerminalPalette;
  search: { matchBackground: string; matchOverviewRuler: string; activeMatchBackground: string; activeMatchColorOverviewRuler: string };
}

const ARGUS_PAINT: Record<ThemeName, Paint> = {
  dark: { surfaces: PAINT_SURFACES.dark, accent: PAINT_ACCENT_SURFACES.dark, syntax: PAINT_SYNTAX.dark, terminal: TERMINAL_THEMES.dark, search: TERMINAL_SEARCH_DECORATIONS.dark },
  light: { surfaces: PAINT_SURFACES.light, accent: PAINT_ACCENT_SURFACES.light, syntax: PAINT_SYNTAX.light, terminal: TERMINAL_THEMES.light, search: TERMINAL_SEARCH_DECORATIONS.light },
};

/** Paint for a theme in one appearance. Argus reads the constants above; the
 *  other themes read the same derived values their CSS was generated from. */
export function paintFor(palette: PaletteId, theme: ThemeName): Paint {
  const d = derivedTheme(palette, theme);
  if (!d) return ARGUS_PAINT[theme];
  const v = d.vars;
  return {
    surfaces: { terminal: v['--bg-2'], inset: v['--bg-inset'] },
    accent: { panel: v['--bg-1'], card: v['--bg-2'], brand: v['--accent'] },
    syntax: { fg: v['--fg-1'], kw: v['--syn-kw'], str: v['--syn-str'], num: v['--syn-num'], fn: v['--syn-fn'], cm: v['--syn-cm'], pn: v['--syn-pn'] },
    terminal: d.terminal,
    search: d.search,
  };
}
