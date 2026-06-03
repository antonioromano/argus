import { useCallback, useState } from 'react';

export type KeyboardMode = 'hybrid' | 'dual';

const KEY = 'argus.mobile.keyboard-mode';
const DEFAULT: KeyboardMode = 'hybrid';

function read(): KeyboardMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'hybrid' || v === 'dual' ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/**
 * Persisted mobile keyboard mode.
 * - `hybrid` (default): special-actions pad + native OS keyboard on demand.
 * - `dual`: two-view fully custom keyboard (KEYS + custom QWERTY).
 * Mirrors the localStorage pattern in ThemeContext.
 */
export function useKeyboardMode(): [KeyboardMode, (m: KeyboardMode) => void] {
  const [mode, setModeState] = useState<KeyboardMode>(read);
  const setMode = useCallback((m: KeyboardMode) => {
    setModeState(m);
    try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
  }, []);
  return [mode, setMode];
}
