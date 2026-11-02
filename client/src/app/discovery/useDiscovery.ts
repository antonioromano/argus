import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { AppConfig, DiscoveryState } from '@argus/shared';
import { normalizeDiscovery, sameDiscovery } from './discoveryState.js';

export type PatchDiscovery = (fn: (s: DiscoveryState) => DiscoveryState) => Promise<void>;

export interface DiscoveryApi {
  discovery: DiscoveryState;
  /** Apply `fn` to the latest state and save the whole object. Serialized, so
   *  two quick events can't clobber each other. No-op outside the main window. */
  patch: PatchDiscovery;
}

/**
 * The one writer of `config.discovery`. Config is not pushed across windows,
 * so only the main window writes it; a secondary window would race with stale
 * state. Writes before the config has loaded are dropped rather than written
 * over an unknown file.
 */
export function useDiscovery({
  config,
  updateConfig,
  isMainWindow,
}: {
  config: AppConfig | null;
  updateConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  isMainWindow: boolean;
}): DiscoveryApi {
  const discovery = useMemo(() => normalizeDiscovery(config?.discovery), [config?.discovery]);
  const loaded = !!config;

  const latest = useRef(discovery);
  const pending = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  // Follow the server copy, except mid-write: an unrelated PUT that started
  // earlier can come back carrying the pre-write object.
  useEffect(() => {
    if (pending.current === 0) latest.current = discovery;
  }, [discovery]);

  const live = useRef({ loaded, isMainWindow, updateConfig });
  useEffect(() => { live.current = { loaded, isMainWindow, updateConfig }; });

  const patch = useCallback<PatchDiscovery>((fn) => {
    const { loaded: ready, isMainWindow: main } = live.current;
    if (!ready || !main) return Promise.resolve();
    pending.current += 1;
    chain.current = chain.current
      .then(async () => {
        const next = fn(latest.current);
        if (sameDiscovery(next, latest.current)) return;
        latest.current = next;
        await live.current.updateConfig({ discovery: next });
      })
      .catch((err: unknown) => console.error('[discovery] save failed', err))
      .finally(() => { pending.current -= 1; });
    return chain.current;
  }, []);

  return useMemo(() => ({ discovery, patch }), [discovery, patch]);
}
