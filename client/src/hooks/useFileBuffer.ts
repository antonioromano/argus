import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { pushToast } from '../components/primitives/Toast.js';

const AUTOSAVE_MS = 5000;

export interface UseFileBufferState {
  content: string;
  initialContent: string;
  mtimeMs: number;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  loading: boolean;
  error: string | null;
  truncated: boolean;
}

export interface UseFileBufferResult extends UseFileBufferState {
  setContent: (next: string) => void;
  save: () => Promise<void>;
  reload: () => Promise<void>;
}

interface UseFileBufferOptions {
  sessionId: string;
  filePath: string | null;
}

export function useFileBuffer({ sessionId, filePath }: UseFileBufferOptions): UseFileBufferResult {
  const [state, setState] = useState<UseFileBufferState>({
    content: '',
    initialContent: '',
    mtimeMs: 0,
    dirty: false,
    saving: false,
    conflict: false,
    loading: false,
    error: null,
    truncated: false,
  });

  const stateRef = useRef(state);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filePathRef = useRef<string | null>(filePath);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    filePathRef.current = filePath;
  }, [filePath]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Persist a queued autosave without UI churn. Used on unmount / file switch so
  // an edit made within the AUTOSAVE_MS window isn't silently lost. Reads refs,
  // so it stays valid during effect cleanup (filePathRef still holds the path
  // being torn down at that point).
  const flush = useCallback(async () => {
    const cur = stateRef.current;
    const path = filePathRef.current;
    if (!path || !cur.dirty || cur.saving) return;
    try {
      await api.writeFile({
        sessionId,
        path,
        content: cur.content,
        originalMtimeMs: cur.mtimeMs || undefined,
      });
    } catch {
      // Best-effort flush; the interactive save() path surfaces errors to the user.
    }
  }, [sessionId]);

  const load = useCallback(async (path: string) => {
    setState((s) => ({ ...s, loading: true, error: null, conflict: false }));
    try {
      const res = await api.getFileContent(path);
      if (filePathRef.current !== path) return;
      setState({
        content: res.content,
        initialContent: res.content,
        mtimeMs: res.mtimeMs,
        dirty: false,
        saving: false,
        conflict: false,
        loading: false,
        error: null,
        truncated: res.truncated,
      });
    } catch (err) {
      if (filePathRef.current !== path) return;
      const msg = err instanceof Error ? err.message : 'Failed to load file';
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, []);

  // (Re)load when filePath changes.
  useEffect(() => {
    clearTimer();
    if (!filePath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({
        content: '',
        initialContent: '',
        mtimeMs: 0,
        dirty: false,
        saving: false,
        conflict: false,
        loading: false,
        error: null,
        truncated: false,
      });
      return;
    }
    void load(filePath);
    return () => {
      clearTimer();
      void flush(); // persist a pending autosave for the file being switched away from
    };
  }, [filePath, load, clearTimer, flush]);

  const save = useCallback(async () => {
    const cur = stateRef.current;
    const path = filePathRef.current;
    if (!path) return;
    if (!cur.dirty || cur.saving) return;
    clearTimer();
    setState((s) => ({ ...s, saving: true }));
    try {
      const res = await api.writeFile({
        sessionId,
        path,
        content: cur.content,
        originalMtimeMs: cur.mtimeMs || undefined,
      });
      if (filePathRef.current !== path) return;
      if (res.conflict) {
        setState((s) => ({ ...s, saving: false, conflict: true }));
        pushToast('File changed on disk — reload', 'warn');
        return;
      }
      if (!res.success) {
        setState((s) => ({ ...s, saving: false, error: res.error ?? 'Save failed' }));
        pushToast(res.error ?? 'Save failed', 'danger');
        return;
      }
      setState((s) => ({
        ...s,
        initialContent: s.content,
        mtimeMs: res.mtimeMs,
        dirty: false,
        saving: false,
        conflict: false,
        error: null,
      }));
      pushToast('Saved', 'ok');
    } catch (err) {
      if (filePathRef.current !== path) return;
      const msg = err instanceof Error ? err.message : 'Save failed';
      setState((s) => ({ ...s, saving: false, error: msg }));
      pushToast(msg, 'danger');
    }
  }, [sessionId, clearTimer]);

  const setContent = useCallback((next: string) => {
    setState((s) => ({ ...s, content: next, dirty: next !== s.initialContent }));
    clearTimer();
    timerRef.current = setTimeout(() => {
      void save();
    }, AUTOSAVE_MS);
  }, [save, clearTimer]);

  const reload = useCallback(async () => {
    if (!filePath) return;
    await load(filePath);
  }, [filePath, load]);

  // Cleanup: flush a pending autosave, then cancel the timer on unmount.
  useEffect(() => {
    return () => {
      clearTimer();
      void flush();
    };
  }, [clearTimer, flush]);

  return { ...state, setContent, save, reload };
}
