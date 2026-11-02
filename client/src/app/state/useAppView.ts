import { useCallback, useEffect, useState } from 'react';
import { isMaximizedPanel, type MaximizablePanel, type Overlay, type SidePanel, type View } from '../types.js';
import { myWindowId } from '../../utils/windowId.js';
import { viewKey } from './windowUiState.js';

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
  toggleSidePanel: (kind: 'diff' | 'explorer' | 'terminal' | 'activity', sessionId: string) => void;
  /** Open (or switch to) a diff/explorer tool window in full-view over the shell. */
  maximizeSidePanel: (panel: MaximizablePanel) => void;
  /** Open a maximized tool window AND remember the current view as its origin, so
   *  dismissing it returns there (dashboard → mosaic, focus → shell). */
  openMaximized: (panel: MaximizablePanel) => void;
  /** Close the maximized tool window, returning to its launch origin. */
  dismissMaximized: () => void;
}

// ---- Relaunch persistence (plan 009 W2) ----
// The view, focused session and open side panel are saved per window in
// localStorage, so both a Cmd+R reload and a relaunch reopen the window as it
// was. Overlays are transient and always start closed. ArgusApp drops a
// restored focus whose session is gone or now owned by another window.

export interface PersistedView {
  view: View;
  activeSessionId: string | null;
  sidePanel: SidePanel;
  maximizedOrigin: View | null;
}

const DASHBOARD: PersistedView = { view: 'dashboard', activeSessionId: null, sidePanel: null, maximizedOrigin: null };

/** Panels that can reopen from a plain record. A PR diff carries a fetched PR
 *  and is opened from it, so it never restores. */
const RESTORABLE_PANELS = new Set(['diff', 'explorer', 'terminal', 'activity']);

function restorablePanel(p: unknown, sessionId: string): SidePanel {
  if (!p || typeof p !== 'object') return null;
  const { kind, sessionId: sid, maximized } = p as { kind?: unknown; sessionId?: unknown; maximized?: unknown };
  if (typeof kind !== 'string' || !RESTORABLE_PANELS.has(kind) || sid !== sessionId) return null;
  if ((kind === 'diff' || kind === 'explorer') && maximized === true) {
    return { kind, sessionId, maximized: true };
  }
  return { kind, sessionId } as SidePanel;
}

/** Read this window's persisted view. Only a `focus` view naming a session
 *  restores; anything else (or malformed/missing storage) → the dashboard. */
export function loadPersistedView(windowId: string): PersistedView {
  try {
    const raw = localStorage.getItem(viewKey(windowId));
    if (raw) {
      const p = JSON.parse(raw) as Partial<PersistedView>;
      if (p.view === 'focus' && typeof p.activeSessionId === 'string') {
        const sidePanel = restorablePanel(p.sidePanel, p.activeSessionId);
        const origin = p.maximizedOrigin === 'dashboard' || p.maximizedOrigin === 'focus' ? p.maximizedOrigin : null;
        return {
          view: 'focus',
          activeSessionId: p.activeSessionId,
          sidePanel,
          maximizedOrigin: isMaximizedPanel(sidePanel) ? origin ?? 'focus' : null,
        };
      }
    }
  } catch {
    /* storage unavailable / malformed — fall through to default */
  }
  return DASHBOARD;
}

/** Persist a focused view (with its panel); clear the key for any other view. */
export function persistView(windowId: string, state: Pick<AppViewState, 'view' | 'activeSessionId' | 'sidePanel' | 'maximizedOrigin'>): void {
  try {
    if (state.view === 'focus' && state.activeSessionId) {
      const panel = restorablePanel(state.sidePanel, state.activeSessionId);
      const record: PersistedView = {
        view: 'focus',
        activeSessionId: state.activeSessionId,
        sidePanel: panel,
        maximizedOrigin: isMaximizedPanel(panel) ? state.maximizedOrigin : null,
      };
      localStorage.setItem(viewKey(windowId), JSON.stringify(record));
    } else {
      localStorage.removeItem(viewKey(windowId));
    }
  } catch {
    /* best-effort persistence */
  }
}

// ---- Pure state transitions (unit-tested in useAppView.test.ts) ----

/** Toggle a side panel; switching kind always drops any `maximized` flag. */
export function toggleSidePanelState(
  s: AppViewState,
  kind: 'diff' | 'explorer' | 'terminal' | 'activity',
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
export function useAppView(windowId: string = myWindowId): AppViewApi {
  const [state, setState] = useState<AppViewState>(() => ({ ...loadPersistedView(windowId), overlay: null }));

  // Persist the focused view and its panel so a reload or relaunch returns to
  // the same session. ArgusApp validates the restored session id once the list
  // loads and exits focus if it no longer exists or belongs to another window.
  useEffect(() => {
    persistView(windowId, state);
  }, [windowId, state]);

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

  const toggleSidePanel = useCallback((kind: 'diff' | 'explorer' | 'terminal' | 'activity', sessionId: string) => {
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
          if (isMaximizedPanel(s.sidePanel)) {
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
