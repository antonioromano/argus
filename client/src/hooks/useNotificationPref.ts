import { useCallback, useState } from 'react';

const KEY = 'argus.mobile.notify';

function read(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** Persisted "alert me when a shell needs input" preference (mobile only). */
export function useNotificationPref(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabledState] = useState<boolean>(read);
  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }, []);
  return [enabled, setEnabled];
}
