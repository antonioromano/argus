import { useEffect, useState } from 'react';
import type { TerminalEngine } from '@argus/shared';

/** True when the native terminal engine is actually available — i.e. main
 *  loaded the addon (macOS, addon present and loadable). This is the app-wide
 *  availability check, resolved once — Focus and Mosaic each call it a
 *  single time at their root so every tile/session agrees while the async
 *  probe is in flight. It does NOT decide per session; see
 *  resolveTerminalEngine for that.
 *
 *  No VITE_ARGUS_NATIVE_TERM build flag any more: the engine is chosen in
 *  Settings and per session in the Create/Clone sheets. A build flag on top
 *  of that would be a second switch, invisible in the UI, able to silently
 *  override an explicit choice. Availability alone is the veto, and it
 *  answers false off macOS or whenever the addon failed to load — which is
 *  exactly the fallback contract resolveTerminalEngine encodes. */
export function useNativeTerminalAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const api = (window as Window & {
      electronNativeTerminal?: { available: () => Promise<boolean> };
    }).electronNativeTerminal;
    if (!api) return;
    let cancelled = false;
    api.available().then((ok) => { if (!cancelled) setAvailable(ok); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return available;
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
