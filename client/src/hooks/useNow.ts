import { useEffect, useState } from 'react';

/**
 * `Date.now()`, refreshed every `intervalMs` while mounted and `enabled`.
 * Disabled, it keeps the last value and runs no timer.
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    // Back on after a pause: catch up now, not one interval later.
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [intervalMs, enabled]);
  return now;
}
