import { useEffect, useState } from 'react';

/** How long a load runs before its skeleton appears: faster loads show nothing. */
export const SKELETON_DELAY_MS = 300;

/**
 * `flag`, but only once it has stayed true for `delayMs`; false again the
 * moment `flag` is. Keeps fast loads from flashing a skeleton.
 */
export function useDelayedFlag(flag: boolean, delayMs: number = SKELETON_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) return;
    const t = setTimeout(() => setShown(true), delayMs);
    return () => {
      clearTimeout(t);
      setShown(false);
    };
  }, [flag, delayMs]);
  return flag && shown;
}
