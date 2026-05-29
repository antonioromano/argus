import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';

const DEBOUNCE_MS = 700;

interface UseDiffInlineEditOptions {
  sessionId: string;
  absolutePath: string | null;
  enabled: boolean;
  onSaved?: () => void;
}

interface FileState {
  lines: string[];
  mtimeMs: number;
}

export interface UseDiffInlineEditResult {
  ready: boolean;
  saving: boolean;
  error: string | null;
  editLine: (lineNo: number, text: string) => void;
  flush: () => Promise<void>;
}

export function useDiffInlineEdit({
  sessionId,
  absolutePath,
  enabled,
  onSaved,
}: UseDiffInlineEditOptions): UseDiffInlineEditResult {
  const fileRef = useRef<FileState | null>(null);
  const pendingRef = useRef<Map<number, string>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load file when path changes.
  useEffect(() => {
    fileRef.current = null;
    pendingRef.current.clear();
    setReady(false);
    setError(null);
    if (!enabled || !absolutePath) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getFileContent(absolutePath);
        if (cancelled) return;
        fileRef.current = {
          lines: res.content.split('\n'),
          mtimeMs: res.mtimeMs,
        };
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'load failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [absolutePath, enabled]);

  const flush = useCallback(async () => {
    if (!absolutePath || !fileRef.current || pendingRef.current.size === 0) return;
    const file = fileRef.current;
    const edits = new Map(pendingRef.current);
    pendingRef.current.clear();
    // Apply pending edits.
    for (const [lineNo, text] of edits) {
      const idx = lineNo - 1;
      if (idx < 0 || idx >= file.lines.length) continue;
      file.lines[idx] = text;
    }
    setSaving(true);
    setError(null);
    try {
      const next = file.lines.join('\n');
      const res = await api.writeFile({
        sessionId,
        path: absolutePath,
        content: next,
        originalMtimeMs: file.mtimeMs,
      });
      if (res.success) {
        file.mtimeMs = res.mtimeMs;
        onSaved?.();
      } else if (res.conflict) {
        setError('File changed on disk; reload to continue editing.');
      } else if (res.error) {
        setError(res.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }, [absolutePath, sessionId, onSaved]);

  const editLine = useCallback(
    (lineNo: number, text: string) => {
      if (!fileRef.current) return;
      pendingRef.current.set(lineNo, text);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  // Flush on unmount or path change.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Fire-and-forget; the file state still in fileRef should be valid up to here.
      void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absolutePath]);

  return { ready, saving, error, editLine, flush };
}
