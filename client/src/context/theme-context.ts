import { createContext, useContext } from 'react';
import type { PaletteId } from '../tokens/palettes.js';

// The resolved (applied) theme — what actually gets written to the DOM
export type Theme = 'dark' | 'light';

// The user's preference, including the "follow system" option
export type ThemeMode = 'dark' | 'light' | 'system';

export interface ThemeContextValue {
  theme: Theme;         // resolved theme applied to DOM
  isDark: boolean;
  mode: ThemeMode;      // user's stored preference (system/dark/light)
  setMode: (m: ThemeMode) => void;
  toggle: () => void;   // backwards compat: cycles dark↔light (bypasses system mode)
  /** Color theme (Argus, One, GitHub, …); each has a dark and a light half. */
  palette: PaletteId;
  setPalette: (p: PaletteId) => void;
  /** When this window last changed mode or palette itself (0 = never); a
   *  change arriving from another window does not count. */
  localEditAt: number;
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  isDark: true,
  mode: 'system',
  setMode: () => {},
  toggle: () => {},
  palette: 'argus',
  setPalette: () => {},
  localEditAt: 0,
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
