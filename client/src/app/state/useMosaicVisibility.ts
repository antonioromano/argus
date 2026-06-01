import { useCallback, useState } from 'react';

const EMPTY_SET: ReadonlySet<string> = new Set();

export interface MosaicVisibilityApi {
  toggleMinimize: (id: string) => void;
  restoreFromFilter: (id: string, currentGroup: string | null) => void;
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
export function useMosaicVisibility(): MosaicVisibilityApi {
  const [minimized, setMinimized] = useState<Set<string>>(new Set());
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

  const isMinimized = useCallback(
    (id: string, groupFilterIds: Set<string> | null | undefined, activeGroupId: string | null | undefined) => {
      const currentGroup = activeGroupId ?? null;
      const forceShown = forced.group === currentGroup ? forced.ids : EMPTY_SET;
      return groupFilterIds ? (!groupFilterIds.has(id) && !forceShown.has(id)) : minimized.has(id);
    },
    [minimized, forced],
  );

  return { toggleMinimize, restoreFromFilter, isMinimized };
}
