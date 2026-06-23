import { createContext, useContext } from 'react';

// Base font sizes (px). Zoom (Electron page zoom) multiplies these at render time.
export const DEFAULT_UI_FONT_SIZE = 14;
export const DEFAULT_CODE_FONT_SIZE = 13;

export interface FontSettingsContextValue {
  uiFontSize: number;   // interface chrome base size (px)
  codeFontSize: number; // terminals / file viewer / diffs base size (px)
}

export const FontSettingsContext = createContext<FontSettingsContextValue>({
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
});

export function useFontSettings(): FontSettingsContextValue {
  return useContext(FontSettingsContext);
}
