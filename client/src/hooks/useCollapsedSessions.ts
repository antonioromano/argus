import { useState, useCallback } from 'react';

const STORAGE_KEY = 'orchestrator:collapsed-sessions';

function readFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed as string[]);
  } catch {
    // ignore parse errors
  }
  return new Set();
}

function writeToStorage(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore storage errors (private browsing, quota exceeded)
  }
}

export function useCollapsedSessions() {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => readFromStorage());

  const collapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      writeToStorage(next);
      return next;
    });
  }, []);

  const uncollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      writeToStorage(next);
      return next;
    });
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      writeToStorage(next);
      return next;
    });
  }, []);

  const isCollapsed = useCallback((id: string) => collapsedIds.has(id), [collapsedIds]);

  return { collapsedIds, isCollapsed, collapse, uncollapse, toggleCollapse };
}
