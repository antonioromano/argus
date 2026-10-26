/** localStorage key of the sidebar's collapsed state (Sidebar owns writes). */
export const SIDEBAR_COLLAPSE_KEY = 'argus-sidebar-collapsed';

/** The persisted collapsed state, readable before the Sidebar mounts. */
export function readSidebarCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1'; } catch { return false; }
}
