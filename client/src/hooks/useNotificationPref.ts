import { useCallback, useState } from 'react';

const KEY = 'argus.mobile.notify';
const DONE_KEY = 'argus.mobile.notifyDone';

function read(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function usePersistedBool(key: string): [boolean, (v: boolean) => void] {
  const [enabled, setEnabledState] = useState<boolean>(() => read(key));
  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ }
  }, [key]);
  return [enabled, setEnabled];
}

/** Persisted "alert me when a shell needs input" preference (mobile only). */
export function useNotificationPref(): [boolean, (v: boolean) => void] {
  return usePersistedBool(KEY);
}

/** Persisted "alert me when a shell finishes a run" preference (mobile only). */
export function useDoneNotificationPref(): [boolean, (v: boolean) => void] {
  return usePersistedBool(DONE_KEY);
}
