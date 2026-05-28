import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';

// The resolved (applied) theme — what actually gets written to the DOM
type Theme = 'dark' | 'light';

// The user's preference, including the "follow system" option
export type ThemeMode = 'dark' | 'light' | 'system';

export interface ThemeContextValue {
  theme: Theme;         // resolved theme applied to DOM
  isDark: boolean;
  mode: ThemeMode;      // user's stored preference (system/dark/light)
  setMode: (m: ThemeMode) => void;
  toggle: () => void;   // backwards compat: cycles dark↔light (bypasses system mode)
}

// --- Helpers ---

function getInitialMode(): ThemeMode {
  // Check new key first
  const stored = localStorage.getItem('theme-mode');
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;

  // Fall back to legacy 'theme' key for backwards compat
  const legacy = localStorage.getItem('theme');
  if (legacy === 'dark' || legacy === 'light') return legacy;

  // Default: follow the OS
  return 'system';
}

function resolveTheme(mode: ThemeMode, systemIsDark: boolean): Theme {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemIsDark ? 'dark' : 'light';
}

// --- Context ---

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  isDark: true,
  mode: 'system',
  setMode: () => {},
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);
  const [systemIsDark, setSystemIsDark] = useState<boolean>(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  // Derived — no extra state needed
  const theme = resolveTheme(mode, systemIsDark);

  // Listen for OS-level colour scheme changes only while in system mode
  useEffect(() => {
    if (mode !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  // Apply resolved theme to the DOM
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Keep body font in sync for non-token consumers (e.g. xterm default text colour)
    document.body.style.fontFamily =
      'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)';
  }, [theme]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    localStorage.setItem('theme-mode', m);
  }, []);

  // Backwards-compat toggle: flips between dark and light explicitly,
  // exiting system mode if it was active.
  const toggle = useCallback(() => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    const apply = () => {
      setModeState(next);
      localStorage.setItem('theme-mode', next);
    };
    if (!document.startViewTransition) { apply(); return; }
    document.startViewTransition(() => flushSync(apply));
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', mode, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
