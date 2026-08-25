import { useCallback, useEffect, useState } from 'react';

const EMPTY_SET: ReadonlySet<string> = new Set();

// Exported for unit testing (no @testing-library/react in this repo, so the
// decision logic is kept as plain functions the hook wires up to React state).
export function storageKey(myWindowId: string): string {
  return `mosaic-minimized:${myWindowId}`;
}

export function loadMinimized(myWindowId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(myWindowId))
      // Legacy key (pre-multi-window) applies to the main window only.
      ?? (myWindowId === 'main' ? localStorage.getItem('mosaic-minimized') : null);
    if (!raw) return new Set();
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids.filter((id): id is string => typeof id === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * The ownership + group-filter + hand-minimize decision, factored out of the
 * hook so it's testable without mounting React. A foreign session is always
 * minimized (collapsed to its chip) regardless of group filter or force-show —
 * exclusive ownership means a session never renders as a live tile outside the
 * window that owns it.
 */
export function computeIsMinimized(
  id: string,
  groupFilterIds: Set<string> | null | undefined,
  activeGroupId: string | null | undefined,
  minimized: ReadonlySet<string>,
  forced: { group: string | null; ids: ReadonlySet<string> },
  isForeign: (id: string) => boolean,
): boolean {
  if (isForeign(id)) return true;
  const currentGroup = activeGroupId ?? null;
  const forceShown = forced.group === currentGroup ? forced.ids : EMPTY_SET;
  return groupFilterIds ? (!groupFilterIds.has(id) && !forceShown.has(id)) : minimized.has(id);
}

export interface MosaicVisibilityApi {
  toggleMinimize: (id: string) => void;
  restoreFromFilter: (id: string, currentGroup: string | null) => void;
  /** Un-minimize every given shell at once (Landing "Restore all"). Clears them from the
   *  hand-minimize set and force-shows them, so it works with or without a group filter. */
  restoreAll: (ids: string[], currentGroup: string | null) => void;
  /**
   * With a group filter active, the filter alone decides visibility: members stay active
   * (even if hand-minimized), non-members collapse — unless force-shown by a chip click.
   * No filter → plain hand-minimize state.
   */
  isMinimized: (id: string, groupFilterIds: Set<string> | null | undefined, activeGroupId: string | null | undefined) => boolean;
}

/**
 * Owns the mosaic's minimized / force-shown state. Lives above the dashboard↔focus mount
 * boundary so minimized shells survive a focus round-trip (Mosaic unmounts in focus view).
 */
export function useMosaicVisibility(myWindowId: string, isForeign: (id: string) => boolean): MosaicVisibilityApi {
  const [minimized, setMinimized] = useState<Set<string>>(() => loadMinimized(myWindowId));

  // Persist hand-minimize state so minimized shells survive a Cmd+R reload.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(myWindowId), JSON.stringify([...minimized]));
    } catch {
      // ignore quota/private-mode failures — minimize state is non-critical
    }
  }, [minimized, myWindowId]);
  // Shells the user clicked to pop back out of the filtered chip row (bypass the group filter).
  // Tagged with the group they belong to so they auto-reset when the active filter changes.
  const [forced, setForced] = useState<{ group: string | null; ids: Set<string> }>({ group: null, ids: new Set() });

  const toggleMinimize = useCallback((id: string) => {
    setMinimized((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const restoreFromFilter = useCallback((id: string, currentGroup: string | null) => {
    setForced((prev) => {
      const ids = new Set(prev.group === currentGroup ? prev.ids : []);
      ids.add(id);
      return { group: currentGroup, ids };
    });
  }, []);

  const restoreAll = useCallback((ids: string[], currentGroup: string | null) => {
    if (ids.length === 0) return;
    // No-filter path: drop them from the hand-minimize set.
    setMinimized((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    // Group-filter path: force-show them (harmless when no filter is active).
    setForced((prev) => {
      const next = new Set(prev.group === currentGroup ? prev.ids : []);
      ids.forEach((id) => next.add(id));
      return { group: currentGroup, ids: next };
    });
  }, []);

  const isMinimized = useCallback(
    (id: string, groupFilterIds: Set<string> | null | undefined, activeGroupId: string | null | undefined) =>
      computeIsMinimized(id, groupFilterIds, activeGroupId, minimized, forced, isForeign),
    [minimized, forced, isForeign],
  );

  return { toggleMinimize, restoreFromFilter, restoreAll, isMinimized };
}
