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
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  isDark: true,
  mode: 'system',
  setMode: () => {},
  toggle: () => {},
  palette: 'argus',
  setPalette: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
