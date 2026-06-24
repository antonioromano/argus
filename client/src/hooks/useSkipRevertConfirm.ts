import { useCallback, useState } from 'react';

const SKIP_CONFIRM_KEY = 'argus.revert.skipConfirm';

/**
 * Shared "skip this confirm next time" preference for revert/rollback/discard
 * actions, persisted to localStorage. Each consumer reads the value at mount;
 * localStorage is the source of truth across the diff UI.
 */
export function useSkipRevertConfirm() {
  const [skip, setSkip] = useState(() => localStorage.getItem(SKIP_CONFIRM_KEY) === '1');
  const toggle = useCallback(() => {
    setSkip((s) => {
      const next = !s;
      if (next) localStorage.setItem(SKIP_CONFIRM_KEY, '1');
      else localStorage.removeItem(SKIP_CONFIRM_KEY);
      return next;
    });
  }, []);
  return { skip, toggle };
}
