import { api } from '../services/api.js';
import { pushToast } from '../components/primitives/index.js';

let checked = false;

/**
 * F16 launch check: one scan per renderer, and the server sets `notify` only on
 * the first startup scan of its process, so the toast shows at most once per
 * launch across windows and reloads. Failures are silent: it is advisory.
 */
export function checkOrphansOnStartup(): void {
  if (checked) return;
  checked = true;
  Promise.resolve().then(() => api.getOrphans(true)).then((r) => {
    if (!r.notify || r.daemons.length === 0) return;
    const mb = Math.round(r.totalRssKb / 1024);
    pushToast(
      `${r.agents.length} orphan agent(s) under ${r.daemons.length} stale daemon(s), ${mb} MB. See Settings → Runtime.`,
      'danger',
    );
  }).catch(() => { /* advisory only */ });
}
