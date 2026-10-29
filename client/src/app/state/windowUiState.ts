/**
 * Per-window UI state that survives a relaunch (plan 009 W2): the view and
 * focused session, the open side panel, the group filter. Kept in this
 * renderer's localStorage keyed by windowId — it is view state for this Mac,
 * not something the server or the phone needs. Every key is `argus.<what>.<windowId>`
 * so a closed window's state can be dropped in one sweep.
 */

export const viewKey = (windowId: string) => `argus.appView.${windowId}`;
export const groupFilterKey = (windowId: string) => `argus.groupFilter.${windowId}`;

/** Remove every `argus.*.<windowId>` key (the window was closed for good). */
export function clearWindowUiState(windowId: string): void {
  try {
    const suffix = `.${windowId}`;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('argus.') && k.endsWith(suffix)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* storage unavailable — nothing to clean */
  }
}

const LIVE_MARKER = 'argus.rendererLive';

/**
 * True on the first load of this window since the app launched, false after a
 * Cmd+R reload. sessionStorage lives as long as the window, so the marker set
 * here is still there after a reload and gone after a relaunch.
 */
export function consumeFreshLaunch(): boolean {
  try {
    const fresh = sessionStorage.getItem(LIVE_MARKER) === null;
    sessionStorage.setItem(LIVE_MARKER, '1');
    return fresh;
  } catch {
    return true;
  }
}

export function loadGroupFilter(windowId: string): string | null {
  try {
    const v = localStorage.getItem(groupFilterKey(windowId));
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function persistGroupFilter(windowId: string, groupId: string | null): void {
  try {
    if (groupId) localStorage.setItem(groupFilterKey(windowId), groupId);
    else localStorage.removeItem(groupFilterKey(windowId));
  } catch {
    /* best effort */
  }
}
