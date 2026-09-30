import { useCallback, useEffect, useState } from 'react';
import type { LaunchActionResult, PendingLaunchView, SaveAsLauncher } from '@argus/shared';

/** Pending deep-link launches for THIS window. State lives in Electron main;
 *  `launch:changed` is only a hint to re-read it (survives renderer reloads). */
export function useLaunches() {
  const bridge = typeof window !== 'undefined' ? window.electronLaunch : undefined;
  const [pending, setPending] = useState<PendingLaunchView[]>([]);
  const refresh = useCallback(() => { void bridge?.list().then(setPending).catch(() => {}); }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    refresh();
    return bridge.onChanged(refresh);
  }, [bridge, refresh]);

  const approve = useCallback(
    (id: string, saveAs?: SaveAsLauncher): Promise<LaunchActionResult> =>
      bridge ? bridge.approve(id, saveAs) : Promise.resolve({ ok: false, error: 'Unavailable' }),
    [bridge],
  );
  const discard = useCallback((id: string) => (bridge ? bridge.discard(id) : Promise.resolve()), [bridge]);
  return { pending, approve, discard };
}
