import { useState, useEffect, useCallback, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { ThemeContext, type Theme, type ThemeMode } from './theme-context.js';
import { appearanceBridge } from '../hooks/useSystemAppearance.js';
import { installPaletteStylesheet, isPaletteId, type PaletteId } from '../tokens/palettes.js';


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

const PALETTE_KEY = 'theme-palette';

function getInitialPalette(): PaletteId {
  const stored = localStorage.getItem(PALETTE_KEY);
  return isPaletteId(stored) ? stored : 'argus';
}

/** Disable transitions for the two frames a theme swap takes (see setMode). */
function suppressTransitionsForSwap(): void {
  document.documentElement.dataset.themeSwitching = '';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      delete document.documentElement.dataset.themeSwitching;
    });
  });
}

function resolveTheme(mode: ThemeMode, systemIsDark: boolean): Theme {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemIsDark ? 'dark' : 'light';
}

// --- Provider ---

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);
  const [palette, setPaletteState] = useState<PaletteId>(getInitialPalette);
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

  // Color theme: Argus is tokens.css itself; every other theme is one rule in
  // the generated stylesheet, selected by <html data-palette>. Layout effect,
  // so the first paint is already in the stored theme.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (palette === 'argus') { delete root.dataset.palette; return; }
    installPaletteStylesheet();
    root.dataset.palette = palette;
  }, [palette]);

  // Other Argus windows share this origin's localStorage: follow a color theme
  // picked in any of them, so windows never show different themes.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PALETTE_KEY && isPaletteId(e.newValue)) setPaletteState(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Apply resolved theme to the DOM
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Keep body font in sync for non-token consumers (e.g. xterm default text colour)
    document.body.style.fontFamily =
      'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)';
  }, [theme]);

  // Electron: keep the window's vibrancy material in the same appearance as
  // the DOM (nativeTheme.themeSource), so a dark Argus on a light-mode Mac
  // gets a dark sidebar material. System mode hands the choice back to macOS.
  useEffect(() => {
    appearanceBridge()?.setTheme(mode === 'system' ? 'system' : theme);
  }, [mode, theme]);

  const setMode = useCallback((m: ThemeMode) => {
    // Instant, and suppressed while it happens. Argus used to crossfade the
    // whole root through the View Transitions API, but a native terminal
    // overlay is a child NSWindow and cannot be part of a DOM snapshot — its
    // own crossfade was independent of the app's and visibly out of step no
    // matter what it was cued off. On top of that, element-level colour
    // transitions kept running after the view transition ended, so the app
    // appeared to fade twice. Switching with no animation anywhere is the one
    // arrangement that cannot be out of sync.
    //
    // `data-theme-switching` disables transitions (not animations) for the swap
    // (see tokens.css); two frames of it, because the attribute and the theme
    // change must both be in the same style recalculation as the paint that
    // applies them.
    suppressTransitionsForSwap();
    setModeState(m);
    localStorage.setItem('theme-mode', m);
  }, []);

  const setPalette = useCallback((p: PaletteId) => {
    suppressTransitionsForSwap();
    setPaletteState(p);
    localStorage.setItem(PALETTE_KEY, p);
  }, []);

  // Backwards-compat toggle: flips between dark and light explicitly,
  // exiting system mode if it was active.
  const toggle = useCallback(() => {
    setMode(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setMode]);

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', mode, setMode, toggle, palette, setPalette }}>
      {children}
    </ThemeContext.Provider>
  );
}
