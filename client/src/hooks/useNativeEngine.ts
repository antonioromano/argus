import { useEffect, useState } from 'react';
import type { TerminalEngine } from '@argus/shared';

/** True when the native terminal engine is both requested (build flag) and
 *  actually available (addon loaded in main). This is the app-wide
 *  availability check, resolved once — Focus and Mosaic each call it a
 *  single time at their root so every tile/session agrees while the async
 *  probe is in flight. It does NOT decide per session; see
 *  resolveTerminalEngine for that. */
export function useNativeTerminalAvailable(): boolean {
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

/** Whether THIS session renders with the native engine. The rules live here,
 *  in one pure function, because they are the product's fallback contract:
 *  a session preference wins over the app default, and availability vetoes
 *  both. Anything unrecognised counts as "no preference". */
export function resolveTerminalEngine(
  sessionEngine: TerminalEngine | undefined,
  appDefault: TerminalEngine | undefined,
  available: boolean,
): boolean {
  if (!available) return false;
  const choice = sessionEngine === 'web' || sessionEngine === 'native'
    ? sessionEngine
    : (appDefault === 'native' ? 'native' : 'web');
  return choice === 'native';
}
