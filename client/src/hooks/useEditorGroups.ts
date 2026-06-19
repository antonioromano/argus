import { useCallback, useMemo, useState } from 'react';
import {
  initGroups,
  openInGroup,
  openPreviewInGroup,
  pinTab,
  activateTab,
  closeTab,
  splitToRight,
  moveTabToGroup,
  focusGroup,
  type GroupsState,
} from '../components/explorer/editorGroups.js';

export interface UseEditorGroups {
  state: GroupsState;
  /** Open (or activate) a file as a pinned tab in the focused group. */
  open: (path: string) => void;
  /** Open a file in the focused group's reusable preview slot (single-click). */
  preview: (path: string) => void;
  /** Promote a preview tab to a permanent tab. */
  pin: (gi: number, path: string) => void;
  activate: (gi: number, path: string) => void;
  close: (gi: number, path: string) => void;
  focus: (gi: number) => void;
  /** Drag a tab onto the right half → spawn the second group. */
  splitRight: (gi: number, path: string) => void;
  /** Drag a tab onto the other group → move it there (collapses if source empties). */
  moveTo: (fromGi: number, toGi: number, path: string) => void;
}

export function useEditorGroups(initialPath?: string | null): UseEditorGroups {
  const [state, setState] = useState<GroupsState>(() => initGroups(initialPath));

  const open = useCallback((path: string) => {
    setState((s) => openInGroup(s, s.focused, path));
  }, []);
  const preview = useCallback((path: string) => {
    setState((s) => openPreviewInGroup(s, s.focused, path));
  }, []);
  const pin = useCallback((gi: number, path: string) => {
    setState((s) => pinTab(s, gi, path));
  }, []);
  const activate = useCallback((gi: number, path: string) => {
    setState((s) => activateTab(s, gi, path));
  }, []);
  const close = useCallback((gi: number, path: string) => {
    setState((s) => closeTab(s, gi, path));
  }, []);
  const focus = useCallback((gi: number) => {
    setState((s) => focusGroup(s, gi));
  }, []);
  const splitRight = useCallback((gi: number, path: string) => {
    setState((s) => splitToRight(s, gi, path));
  }, []);
  const moveTo = useCallback((fromGi: number, toGi: number, path: string) => {
    setState((s) => moveTabToGroup(s, fromGi, toGi, path));
  }, []);

  return useMemo(
    () => ({ state, open, preview, pin, activate, close, focus, splitRight, moveTo }),
    [state, open, preview, pin, activate, close, focus, splitRight, moveTo],
  );
}
