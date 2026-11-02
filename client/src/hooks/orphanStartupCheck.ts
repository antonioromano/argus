import { api } from '../services/api.js';
import { pushToast } from '../components/primitives/index.js';

let checked = false;

/**
 * F16 launch check: one scan per renderer, and the server sets `notify` only on
 * the first startup scan of its process, so the toast shows at most once per
 * launch across windows and reloads. Failures are silent: it is advisory, so
 * it is a `warn` with a Review action that opens Settings → Runtime.
 */
export function checkOrphansOnStartup(onReview: () => void): void {
  if (checked) return;
  checked = true;
  Promise.resolve().then(() => api.getOrphans(true)).then((r) => {
    if (!r.notify || r.daemons.length === 0) return;
    const mb = Math.round(r.totalRssKb / 1024);
    const agents = `${r.agents.length} orphan agent${r.agents.length === 1 ? '' : 's'}`;
    const daemons = `${r.daemons.length} stale daemon${r.daemons.length === 1 ? '' : 's'}`;
    pushToast(`${agents} under ${daemons} are using ${mb} MB.`, 'warn', {
      action: { label: 'Review', run: onReview },
      durationMs: 10_000,
    });
  }).catch(() => { /* advisory only */ });
}

/** Test seam: forget that the check already ran. */
export function resetOrphanStartupCheck(): void {
  checked = false;
}
