import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, PlanUsage, PlanUsageAgent, PlanUsageMap } from '@argus/shared';
import { api } from '../services/api.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Plan usage per agent account (shared by every shell of that agent). Fetched
 * once and on every reconnect, then kept live by `usage:plan` broadcasts.
 * Skipped entirely while the usage meter is off.
 */
export function usePlanUsage(socket: TypedSocket, enabled: boolean): PlanUsageMap {
  const [plans, setPlans] = useState<PlanUsageMap>({});

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const resync = () => {
      api.getPlanUsage().then((p) => { if (alive) setPlans(p); }).catch(console.error);
    };
    const handle = ({ agent, plan }: { agent: PlanUsageAgent; plan: PlanUsage }) => {
      setPlans((prev) => ({ ...prev, [agent]: plan }));
    };
    resync();
    socket.on('usage:plan', handle);
    socket.on('connect', resync);
    return () => {
      alive = false;
      socket.off('usage:plan', handle);
      socket.off('connect', resync);
    };
  }, [socket, enabled]);

  return plans;
}
