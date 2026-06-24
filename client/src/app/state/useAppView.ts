import { useCallback, useEffect, useState } from 'react';
import type { MaximizablePanel, Overlay, SidePanel, View } from '../types.js';

export interface AppViewState {
  view: View;
  activeSessionId: string | null;
  overlay: Overlay;
  sidePanel: SidePanel;
  /** Where the currently-maximized tool window was launched from, so closing it
   *  returns there (dashboard → mosaic, focus → shell). Null when none is open. */
  maximizedOrigin: View | null;
}

export interface AppViewApi extends AppViewState {
  openSession: (id: string) => void;
  exitFocus: () => void;
  setActiveSession: (id: string) => void;
  openOverlay: (next: NonNullable<Overlay>) => void;
  closeOverlay: () => void;
  openSidePanel: (next: NonNullable<SidePanel>) => void;
  closeSidePanel: () => void;
  toggleSidePanel: (kind: 'diff' | 'explorer' | 'terminal', sessionId: string) => void;
  /** Open (or switch to) a diff/explorer tool window in full-view over the shell. */
  maximizeSidePanel: (panel: MaximizablePanel) => void;
  /** Open a maximized tool window AND remember the current view as its origin, so
   *  dismissing it returns there (dashboard → mosaic, focus → shell). */
  openMaximized: (panel: MaximizablePanel) => void;
  /** Close the maximized tool window, returning to its launch origin. */
  dismissMaximized: () => void;
}

// ---- Cross-reload persistence (Cmd+R) ----
// Focus is ephemeral, so it lives in sessionStorage (cleared when the app
// closes) rather than localStorage. Only the focused view is restored — overlay
// and side-panel state are transient and always start closed.
const PERSIST_KEY = 'argus.appView';

export interface PersistedView {
  view: View;
  activeSessionId: string | null;
}

/** Read the persisted view. Restores only a `focus` view that names a session;
 *  anything else (or malformed/missing storage) → the dashboard default. */
export function loadPersistedView(): PersistedView {
  try {
    const raw = sessionStorage.getItem(PERSIST_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PersistedView>;
      if (p.view === 'focus' && typeof p.activeSessionId === 'string') {
        return { view: 'focus', activeSessionId: p.activeSessionId };
      }
    }
  } catch {
    /* sessionStorage unavailable / malformed — fall through to default */
  }
  return { view: 'dashboard', activeSessionId: null };
}

/** Persist a focused view; clear the key for any non-focus view. */
export function persistView(view: View, activeSessionId: string | null): void {
  try {
    if (view === 'focus' && activeSessionId) {
      sessionStorage.setItem(PERSIST_KEY, JSON.stringify({ view, activeSessionId }));
    } else {
      sessionStorage.removeItem(PERSIST_KEY);
    }
  } catch {
    /* best-effort persistence across Cmd+R */
  }
}

// ---- Pure state transitions (unit-tested in useAppView.test.ts) ----

/** Toggle a side panel; switching kind always drops any `maximized` flag. */
export function toggleSidePanelState(
  s: AppViewState,
  kind: 'diff' | 'explorer' | 'terminal',
  sessionId: string,
): AppViewState {
  const current = s.sidePanel;
  if (current && current.kind === kind && current.sessionId === sessionId) {
    return { ...s, sidePanel: null };
  }
  return { ...s, sidePanel: { kind, sessionId } };
}

/** Open/switch a diff|explorer panel and maximize it (origin = current view if not already set). */
export function maximizeSidePanelState(s: AppViewState, panel: MaximizablePanel): AppViewState {
  return { ...s, sidePanel: { ...panel, maximized: true }, maximizedOrigin: s.maximizedOrigin ?? s.view };
}

/**
 * Open a maximized tool window over a session and record where it was launched
 * from. Captures the *prior* view as origin, so launching from the dashboard
 * (mosaic) returns there on close, while launching from focus returns to the shell.
 */
export function openMaximizedState(s: AppViewState, panel: MaximizablePanel): AppViewState {
  return {
    ...s,
    view: 'focus',
    activeSessionId: panel.sessionId,
    sidePanel: { ...panel, maximized: true },
    maximizedOrigin: s.maximizedOrigin ?? s.view,
  };
}

/** Close the maximized tool window, returning to its launch origin. */
export function dismissMaximizedState(s: AppViewState): AppViewState {
  if (s.maximizedOrigin === 'dashboard') {
    return { ...s, view: 'dashboard', sidePanel: null, maximizedOrigin: null };
  }
  return { ...s, sidePanel: null, maximizedOrigin: null };
}

/**
 * Single source of truth for shell navigation.
 * - view: dashboard ↔ focus
 * - overlay: stacked modal slot
 * - sidePanel: right rail in focus (diff/explorer can additionally be `maximized`
 *   into a full-view tool window over the shell)
 *
 * Keyboard:
 *   Escape → close overlay → close side panel → exit focus (priority). All
 *   rebindable shortcuts (palette, new session, settings, …) are owned by the
 *   registry-driven handler in ArgusApp. Escape stays here.
 */
export function useAppView(): AppViewApi {
  const [state, setState] = useState<AppViewState>(() => {
    const persisted = loadPersistedView();
    return {
      view: persisted.view,
      activeSessionId: persisted.activeSessionId,
      overlay: null,
      sidePanel: null,
      maximizedOrigin: null,
    };
  });

  // Persist the focused view so Cmd+R (renderer reload) returns to the same
  // session instead of dropping to the mosaic. ArgusApp validates the restored
  // session id once the list loads and exits focus if it no longer exists.
  useEffect(() => {
    persistView(state.view, state.activeSessionId);
  }, [state.view, state.activeSessionId]);

  const openSession = useCallback((id: string) => {
    setState((s) => ({ ...s, view: 'focus', activeSessionId: id }));
  }, []);

  const exitFocus = useCallback(() => {
    setState((s) => ({ ...s, view: 'dashboard', sidePanel: null, maximizedOrigin: null }));
  }, []);

  const setActiveSession = useCallback((id: string) => {
    setState((s) => ({ ...s, activeSessionId: id }));
  }, []);

  const openOverlay = useCallback((next: NonNullable<Overlay>) => {
    setState((s) => ({ ...s, overlay: next }));
  }, []);

  const closeOverlay = useCallback(() => {
    setState((s) => ({ ...s, overlay: null }));
  }, []);

  const openSidePanel = useCallback((next: NonNullable<SidePanel>) => {
    setState((s) => ({ ...s, sidePanel: next }));
  }, []);

  const closeSidePanel = useCallback(() => {
    setState((s) => ({ ...s, sidePanel: null }));
  }, []);

  const toggleSidePanel = useCallback((kind: 'diff' | 'explorer' | 'terminal', sessionId: string) => {
    setState((s) => toggleSidePanelState(s, kind, sessionId));
  }, []);

  const maximizeSidePanel = useCallback((panel: MaximizablePanel) => {
    setState((s) => maximizeSidePanelState(s, panel));
  }, []);

  const openMaximized = useCallback((panel: MaximizablePanel) => {
    setState((s) => openMaximizedState(s, panel));
  }, []);

  const dismissMaximized = useCallback(() => {
    setState((s) => dismissMaximizedState(s));
  }, []);

  // Global keyboard — Escape only (fixed). Rebindable shortcuts live in ArgusApp.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setState((s) => {
          if (s.overlay) return { ...s, overlay: null };
          // A maximized tool window closes back to its launch origin (mosaic/shell).
          if (s.sidePanel && s.sidePanel.kind !== 'terminal' && s.sidePanel.maximized) {
            return dismissMaximizedState(s);
          }
          if (s.sidePanel) return { ...s, sidePanel: null };
          if (s.view === 'focus') return { ...s, view: 'dashboard' };
          return s;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return {
    ...state,
    openSession,
    exitFocus,
    setActiveSession,
    openOverlay,
    closeOverlay,
    openSidePanel,
    closeSidePanel,
    toggleSidePanel,
    maximizeSidePanel,
    openMaximized,
    dismissMaximized,
  };
}
