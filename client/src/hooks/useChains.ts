import { useEffect, useMemo, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, SessionChain } from '@argus/shared';
import { api } from '../services/api.js';

const NONE: SessionChain[] = [];

/**
 * Beta F13: the chain list, refetched whenever the server announces
 * `chains:changed`. While `enabled` is false it fetches nothing, listens to
 * nothing and returns an empty list, so the feature is inert.
 */
export function useChains(enabled: boolean, socket?: Socket<ServerToClientEvents, ClientToServerEvents>) {
  const [chains, setChains] = useState<SessionChain[]>(NONE);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refetch = () => {
      api.listChains().then((c) => { if (!cancelled) setChains(c); }).catch(() => { /* flag raced off */ });
    };
    refetch();
    socket?.on('chains:changed', refetch);
    return () => { cancelled = true; socket?.off('chains:changed', refetch); };
  }, [enabled, socket]);

  // Off ⇒ nothing, even if a list was fetched while it was on.
  const visible = enabled ? chains : NONE;

  /** Chains per source session, for the tile indicator. */
  const countsBySource = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of visible) out[c.sourceId] = (out[c.sourceId] ?? 0) + 1;
    return out;
  }, [visible]);

  return { chains: visible, countsBySource };
}
