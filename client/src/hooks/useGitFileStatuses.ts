import { useEffect, useMemo, useState } from 'react';
import type { GitFileStatusCode, GitFileStatusResponse } from '@argus/shared';
import { api } from '../services/api.js';

const POLL_MS = 5000;

interface UseGitFileStatusesOptions {
  sessionId: string;
  enabled: boolean;
}

export function useGitFileStatuses({ sessionId, enabled }: UseGitFileStatusesOptions): Map<string, GitFileStatusCode> {
  const [data, setData] = useState<GitFileStatusResponse | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // Track the last response so we can skip state churn when the new payload is
    // structurally identical (keeps the derived memo stable across polls).
    let prevKey: string | null = null;
    const fetchOnce = async () => {
      // Skip background polling while the window/tab is hidden (matches useGitDiff).
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await api.getGitFileStatuses(sessionId);
        if (cancelled) return;
        const nextKey = JSON.stringify(res);
        if (nextKey === prevKey) return;
        prevKey = nextKey;
        setData(res);
      } catch {
        if (cancelled) return;
        if (prevKey === null) return;
        prevKey = null;
        setData(null);
      }
    };
    void fetchOnce();
    const interval = setInterval(fetchOnce, POLL_MS);
    // Re-fetch immediately when the tab becomes visible again.
    const onVisible = () => { if (document.visibilityState === 'visible') void fetchOnce(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionId, enabled]);

  return useMemo(() => {
    const map = new Map<string, GitFileStatusCode>();
    if (!data?.gitRoot) return map;
    for (const [relPath, status] of Object.entries(data.statuses)) {
      const abs = `${data.gitRoot.replace(/\/$/, '')}/${relPath}`;
      map.set(abs, status);
    }
    return map;
  }, [data]);
}
