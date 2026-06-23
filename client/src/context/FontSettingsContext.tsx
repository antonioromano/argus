import { useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  FontSettingsContext,
  DEFAULT_UI_FONT_SIZE,
  DEFAULT_CODE_FONT_SIZE,
} from './font-settings-context.js';

interface Props {
  uiFontSize?: number;
  codeFontSize?: number;
  children: ReactNode;
}

// Applies the two base font sizes to the DOM:
//   --ui-scale         scales the whole UI type scale (see tokens.css)
//   --code-font-size   drives diff/markdown CSS; terminals & Monaco read the
//                      numeric value via useFontSettings()
export function FontSettingsProvider({ uiFontSize, codeFontSize, children }: Props) {
  const ui = uiFontSize ?? DEFAULT_UI_FONT_SIZE;
  const code = codeFontSize ?? DEFAULT_CODE_FONT_SIZE;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(ui / DEFAULT_UI_FONT_SIZE));
    root.style.setProperty('--code-font-size', `${code}px`);
  }, [ui, code]);

  return (
    <FontSettingsContext.Provider value={{ uiFontSize: ui, codeFontSize: code }}>
      {children}
    </FontSettingsContext.Provider>
  );
}
