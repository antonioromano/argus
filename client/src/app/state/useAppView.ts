import { useCallback, useEffect, useState } from 'react';
import type { Overlay, SidePanel, View } from '../types.js';
import { isPrimaryModifier } from '../../utils/platform.js';

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
}

/**
 * Single source of truth for shell navigation.
 * - view: dashboard ↔ focus
 * - overlay: stacked modal slot
 * - sidePanel: right rail in focus
 *
 * Keyboard:
 *   ⌘K / Ctrl+K → toggle palette
 *   ⌘N / Ctrl+N → open create
 *   Escape      → close overlay → close side panel → exit focus (priority)
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
    setState((s) => {
      const current = s.sidePanel;
      if (current && current.kind === kind && current.sessionId === sessionId) {
        return { ...s, sidePanel: null };
      }
      return { ...s, sidePanel: { kind, sessionId } };
    });
  }, []);

  // Global keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ignore when typing in an input/textarea/contenteditable (xterm uses its own helper textarea)
      const target = e.target as HTMLElement | null;
      const isTyping = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );

      if (isPrimaryModifier(e) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setState((s) => ({ ...s, overlay: s.overlay?.kind === 'palette' ? null : { kind: 'palette' } }));
        return;
      }
      if (isPrimaryModifier(e) && e.key.toLowerCase() === 'n' && !isTyping) {
        e.preventDefault();
        setState((s) => ({ ...s, overlay: { kind: 'create' } }));
        return;
      }
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
  };
}
