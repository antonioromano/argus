import { useState, useEffect, useCallback, useRef } from 'react';
import type { SessionInfo, SessionGroup } from '@argus/shared';
import { api } from '../services/api.js';
import { DEFAULT_GROUP_COLOR } from '../constants/groupColors.js';

// Reserved entry that only carries the Others bucket's color (never holds membership).
export const OTHERS_GROUP_ID = '__others__';

export interface GroupedSessions {
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

  // Split live sessions into groups (in group order, pruning dead ids) + an Others bucket.
  // The reserved OTHERS sentinel only carries the Others color — never a real group.
  const groupedSessions = useCallback((ordered: SessionInfo[]): GroupedSessions => {
    const byId = new Map(ordered.map((s) => [s.id, s]));
    const claimed = new Set<string>();
    const realGroups = groups.filter((g) => g.id !== OTHERS_GROUP_ID);
    const out = realGroups.map((group) => {
      const sessions: SessionInfo[] = [];
      for (const sid of group.sessionIds) {
        const s = byId.get(sid);
        if (s && !claimed.has(sid)) { sessions.push(s); claimed.add(sid); }
      }
      return { group, sessions };
    });
    const others = ordered.filter((s) => !claimed.has(s.id));
    const othersColor = groups.find((g) => g.id === OTHERS_GROUP_ID)?.color ?? null;
    return { groups: out, others, othersColor };
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
  };
}
