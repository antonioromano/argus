import { useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';
import { ThemeContext, type Theme, type ThemeMode } from './theme-context.js';

/**
 * Dispatched on `window` when the theme view transition actually starts
 * animating — not when the theme value changes. Surfaces exist that cannot
 * join a DOM view transition and must crossfade themselves in step with it;
 * see the native terminal overlay in TerminalShell.
 */
export const THEME_TRANSITION_START = 'argus:theme-transition-start';

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

// --- Provider ---

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

  // True between starting a view transition and its `ready` resolving, so the
  // effect below leaves the announcement to the transition rather than firing
  // early.
  const transitionPending = useRef(false);

  // Apply resolved theme to the DOM
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Keep body font in sync for non-token consumers (e.g. xterm default text colour)
    document.body.style.fontFamily =
      'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)';
    // Every theme change that is NOT animated announces itself here: the
    // no-view-transition fallback below, and an OS appearance change, which
    // updates `theme` through systemIsDark without going through setMode. The
    // cue has to fire for those too or a native terminal overlay — which
    // listens for it instead of watching the theme value — would keep the old
    // colours indefinitely.
    if (!transitionPending.current) {
      window.dispatchEvent(new Event(THEME_TRANSITION_START));
    }
  }, [theme]);

  const setMode = useCallback((m: ThemeMode) => {
    const apply = () => {
      setModeState(m);
      localStorage.setItem('theme-mode', m);
    };
    if (!document.startViewTransition) { apply(); return; }
    transitionPending.current = true;
    const transition = document.startViewTransition(() => flushSync(apply));
    // A native terminal overlay is a child NSWindow and cannot take part in a
    // DOM view transition, so it runs its own crossfade (OverlayController's
    // setTheme). It must not start on the theme VALUE changing: the API
    // snapshots the old frame first and only begins animating once `ready`
    // resolves, so the overlay faded a frame or two ahead of the rest of the
    // app and the two were visibly out of step. Announce the real start
    // instead. Fire-and-forget: `ready` rejects if the transition is skipped,
    // which is not an error here — nothing is animating, so nothing needs the
    // cue.
    void transition.ready.then(
      () => {
        transitionPending.current = false;
        window.dispatchEvent(new Event(THEME_TRANSITION_START));
      },
      () => {
        // Skipped transition: nothing animates, so the cue is due now.
        transitionPending.current = false;
        window.dispatchEvent(new Event(THEME_TRANSITION_START));
      },
    );
  }, []);

  // Backwards-compat toggle: flips between dark and light explicitly,
  // exiting system mode if it was active.
  const toggle = useCallback(() => {
    setMode(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setMode]);

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', mode, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
