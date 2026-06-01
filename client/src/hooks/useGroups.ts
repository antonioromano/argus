import { useState, useEffect, useCallback, useRef } from 'react';
import type { SessionInfo, SessionGroup, FavoriteEntryMeta } from '@argus/shared';
import { FAVORITES_GROUP_ID } from '@argus/shared';
import { api } from '../services/api.js';
import { DEFAULT_GROUP_COLOR, OTHERS_DEFAULT_COLOR } from '../constants/groupColors.js';

// Reserved entry that only carries the Others bucket's color (never holds membership).
export const OTHERS_GROUP_ID = '__others__';

export interface GhostFavorite {
  ghost: true;
  id: string;
  meta: FavoriteEntryMeta;
}

export interface FavoritesGroup {
  collapsed: boolean;
  items: Array<SessionInfo | GhostFavorite>;
}

export interface GroupedSessions {
  favorites: FavoritesGroup | null;
  groups: { group: SessionGroup; sessions: SessionInfo[] }[];
  others: SessionInfo[];
  othersColor: string | null;
}

export function useGroups() {
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api.getGroups().then(setGroups).catch(console.error);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const commit = useCallback((next: SessionGroup[]) => {
    setGroups(next);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      api.saveGroups(next).catch(console.error);
    }, 300);
  }, []);

  const createGroup = useCallback((name: string, color: string = DEFAULT_GROUP_COLOR) => {
    setGroups((prev) => {
      const next = [...prev, { id: crypto.randomUUID(), name, color, collapsed: false, sessionIds: [] }];
      commit(next);
      return next;
    });
  }, [commit]);

  const renameGroup = useCallback((id: string, name: string) => {
    setGroups((prev) => {
      const next = prev.map((g) => (g.id === id ? { ...g, name } : g));
      commit(next);
      return next;
    });
  }, [commit]);

  const setColor = useCallback((id: string, color: string) => {
    setGroups((prev) => {
      const next = prev.map((g) => (g.id === id ? { ...g, color } : g));
      commit(next);
      return next;
    });
  }, [commit]);

  const deleteGroup = useCallback((id: string) => {
    if (id === FAVORITES_GROUP_ID) return; // reserved — not user-deletable
    setGroups((prev) => {
      const next = prev.filter((g) => g.id !== id);
      commit(next);
      return next;
    });
  }, [commit]);

  const toggleCollapsed = useCallback((id: string) => {
    setGroups((prev) => {
      const next = prev.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g));
      commit(next);
      return next;
    });
  }, [commit]);

  // Single-membership: drop the session from every group, then add to target (null = Others).
  const assign = useCallback((sessionId: string, groupId: string | null) => {
    setGroups((prev) => {
      const next = prev.map((g) => ({
        ...g,
        sessionIds: g.sessionIds.filter((sid) => sid !== sessionId),
      }));
      if (groupId) {
        const target = next.find((g) => g.id === groupId);
        if (target) target.sessionIds = [...target.sessionIds, sessionId];
      }
      commit(next);
      return next;
    });
  }, [commit]);

  const reorderGroups = useCallback((orderedIds: string[]) => {
    setGroups((prev) => {
      const byId = new Map(prev.map((g) => [g.id, g]));
      const next = orderedIds.map((id) => byId.get(id)).filter((g): g is SessionGroup => !!g);
      for (const g of prev) if (!orderedIds.includes(g.id)) next.push(g);
      commit(next);
      return next;
    });
  }, [commit]);

  const setOthersColor = useCallback((color: string) => {
    setGroups((prev) => {
      const exists = prev.some((g) => g.id === OTHERS_GROUP_ID);
      const next = exists
        ? prev.map((g) => (g.id === OTHERS_GROUP_ID ? { ...g, color } : g))
        : [...prev, { id: OTHERS_GROUP_ID, name: 'Others', color, collapsed: false, sessionIds: [] }];
      commit(next);
      return next;
    });
  }, [commit]);

  const isFavorite = useCallback((sessionId: string): boolean => {
    const favGroup = groups.find((g) => g.id === FAVORITES_GROUP_ID);
    return favGroup ? favGroup.sessionIds.includes(sessionId) : false;
  }, [groups]);

  const removeFromFavorites = useCallback((sessionId: string) => {
    setGroups((prev) => {
      const favGroup = prev.find((g) => g.id === FAVORITES_GROUP_ID);
      if (!favGroup) return prev;

      const nextMeta = { ...(favGroup.entryMeta ?? {}) };
      delete nextMeta[sessionId];

      const nextSessionIds = favGroup.sessionIds.filter((id) => id !== sessionId);

      // Drop the Favourites group entirely when nothing remains
      if (nextSessionIds.length === 0 && Object.keys(nextMeta).length === 0) {
        const next = prev.filter((g) => g.id !== FAVORITES_GROUP_ID);
        commit(next);
        return next;
      }

      const next = prev.map((g) =>
        g.id === FAVORITES_GROUP_ID
          ? { ...g, sessionIds: nextSessionIds, entryMeta: nextMeta }
          : g,
      );
      commit(next);
      return next;
    });
  }, [commit]);

  const toggleFavorite = useCallback((session: SessionInfo) => {
    setGroups((prev) => {
      const favGroup = prev.find((g) => g.id === FAVORITES_GROUP_ID);
      const alreadyFav = favGroup?.sessionIds.includes(session.id) ?? false;

      if (alreadyFav) {
        // Remove from favourites
        const nextMeta = { ...(favGroup!.entryMeta ?? {}) };
        delete nextMeta[session.id];
        const nextSessionIds = favGroup!.sessionIds.filter((id) => id !== session.id);

        if (nextSessionIds.length === 0 && Object.keys(nextMeta).length === 0) {
          const next = prev.filter((g) => g.id !== FAVORITES_GROUP_ID);
          commit(next);
          return next;
        }

        const next = prev.map((g) =>
          g.id === FAVORITES_GROUP_ID
            ? { ...g, sessionIds: nextSessionIds, entryMeta: nextMeta }
            : g,
        );
        commit(next);
        return next;
      }

      // Add to favourites: remove from all other groups first (single-membership)
      const withoutSession = prev.map((g) =>
        g.id === FAVORITES_GROUP_ID ? g : { ...g, sessionIds: g.sessionIds.filter((id) => id !== session.id) },
      );

      const meta: FavoriteEntryMeta = {
        folderPath: session.folderPath,
        name: session.name,
        agentType: session.agentType,
        flags: session.flags,
      };

      const existingFav = withoutSession.find((g) => g.id === FAVORITES_GROUP_ID);
      let next: SessionGroup[];
      if (existingFav) {
        next = withoutSession.map((g) =>
          g.id === FAVORITES_GROUP_ID
            ? { ...g, sessionIds: [...g.sessionIds, session.id], entryMeta: { ...(g.entryMeta ?? {}), [session.id]: meta } }
            : g,
        );
      } else {
        next = [
          { id: FAVORITES_GROUP_ID, name: 'Favourites', color: 'amber', collapsed: false, sessionIds: [session.id], entryMeta: { [session.id]: meta } },
          ...withoutSession,
        ];
      }
      commit(next);
      return next;
    });
  }, [commit]);

  // Split live sessions into groups (in group order, pruning dead ids) + an Others bucket.
  // The reserved OTHERS and FAVORITES sentinels are handled separately.
  const groupedSessions = useCallback((ordered: SessionInfo[]): GroupedSessions => {
    const byId = new Map(ordered.map((s) => [s.id, s]));
    const claimed = new Set<string>();

    // Build favourites section (live sessions + ghost entries)
    const favGroup = groups.find((g) => g.id === FAVORITES_GROUP_ID);
    let favorites: FavoritesGroup | null = null;
    if (favGroup) {
      const items: Array<SessionInfo | GhostFavorite> = [];
      for (const sid of favGroup.sessionIds) {
        const s = byId.get(sid);
        if (s) {
          items.push(s);
          claimed.add(sid);
        } else if (favGroup.entryMeta?.[sid]) {
          items.push({ ghost: true, id: sid, meta: favGroup.entryMeta[sid] });
        }
        // dangling ID with no meta → skip
      }
      if (items.length > 0) {
        favorites = { collapsed: favGroup.collapsed, items };
      }
    }

    const realGroups = groups.filter((g) => g.id !== OTHERS_GROUP_ID && g.id !== FAVORITES_GROUP_ID);
    const out = realGroups.map((group) => {
      const sessions: SessionInfo[] = [];
      for (const sid of group.sessionIds) {
        const s = byId.get(sid);
        if (s && !claimed.has(sid)) { sessions.push(s); claimed.add(sid); }
      }
      return { group, sessions };
    });
    const others = ordered.filter((s) => !claimed.has(s.id));
    const othersColor = groups.find((g) => g.id === OTHERS_GROUP_ID)?.color ?? OTHERS_DEFAULT_COLOR;
    return { favorites, groups: out, others, othersColor };
  }, [groups]);

  const groupIdOf = useCallback((sessionId: string): string | null => {
    for (const g of groups) if (g.id !== OTHERS_GROUP_ID && g.sessionIds.includes(sessionId)) return g.id;
    return null;
  }, [groups]);

  return {
    groups,
    createGroup,
    setOthersColor,
    renameGroup,
    setColor,
    deleteGroup,
    toggleCollapsed,
    assign,
    reorderGroups,
    groupedSessions,
    groupIdOf,
    isFavorite,
    toggleFavorite,
    removeFromFavorites,
  };
}
