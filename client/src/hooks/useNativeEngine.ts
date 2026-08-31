import { useEffect, useState } from 'react';

/** True when the native terminal engine is both requested (build flag) and
 *  actually available (addon loaded in main). Focus and Mosaic must agree, so
 *  the decision lives in one place. */
export function useNativeEngine(): boolean {
  const requested = import.meta.env.VITE_ARGUS_NATIVE_TERM === '1';
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!requested) return;
    const api = (window as Window & {
      electronNativeTerminal?: { available: () => Promise<boolean> };
    }).electronNativeTerminal;
    if (!api) return;
    let cancelled = false;
    api.available().then((ok) => { if (!cancelled) setAvailable(ok); }).catch(() => {});
    return () => { cancelled = true; };
  }, [requested]);
  return requested && available;
}
