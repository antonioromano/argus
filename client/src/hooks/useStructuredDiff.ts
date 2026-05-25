import { useState, useEffect, useCallback, useRef } from 'react';
import type { StructuredDiffResponse } from '@argus/shared';
import { api } from '../services/api.js';

interface UseStructuredDiffResult {
  data: StructuredDiffResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useStructuredDiff(
  sessionId: string,
  filePath: string | null,
  contextLines: number,
  source: 'unstaged' | 'staged' | 'branch'
): UseStructuredDiffResult {
  const [data, setData] = useState<StructuredDiffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!filePath) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const result = await api.getDiffStructured(sessionId, filePath, contextLines, source);
      if (result.error) {
        setError(result.error);
      } else {
        setData(result);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId, filePath, contextLines, source]);

  useEffect(() => {
    setData(null);
    fetchData();
    return () => { abortRef.current?.abort(); };
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
