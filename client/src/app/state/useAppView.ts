import { useCallback, useEffect, useState } from 'react';
import type { MaximizablePanel, Overlay, SidePanel, View } from '../types.js';

export interface AppViewState {
  view: View;
  activeSessionId: string | null;
  overlay: Overlay;
  sidePanel: SidePanel;
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

/** Open/switch a diff|explorer panel and maximize it. */
export function maximizeSidePanelState(s: AppViewState, panel: MaximizablePanel): AppViewState {
  return { ...s, sidePanel: { ...panel, maximized: true } };
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
  const [state, setState] = useState<AppViewState>({
    view: 'dashboard',
    activeSessionId: null,
    overlay: null,
    sidePanel: null,
  });

  const openSession = useCallback((id: string) => {
    setState((s) => ({ ...s, view: 'focus', activeSessionId: id }));
  }, []);

  const exitFocus = useCallback(() => {
    setState((s) => ({ ...s, view: 'dashboard', sidePanel: null }));
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

  // Global keyboard — Escape only (fixed). Rebindable shortcuts live in ArgusApp.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setState((s) => {
          if (s.overlay) return { ...s, overlay: null };
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
  };
}
