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
    const fetchOnce = async () => {
      try {
        const res = await api.getGitFileStatuses(sessionId);
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setData(null);
      }
    };
    void fetchOnce();
    const interval = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
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
