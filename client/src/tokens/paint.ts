/* Argus OS — paint tokens.
 *
 * The few surfaces that are not painted by CSS — xterm.js (and the SwiftTerm
 * native overlay derived from it) and Monaco — take literal #RRGGBB strings, so
 * they cannot read `var(--…)`. Their colors live here instead of inline in each
 * component, mirrored from tokens.css. `tokens/contrast.test.ts` fails if a
 * mirrored value drifts from tokens.css or if any pair here drops below WCAG AA.
 */

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

/** Cell background a terminal paints, for the frame around it to match. */
export function terminalBackground(theme: ThemeName): string {
  return PAINT_SURFACES[theme].terminal;
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
