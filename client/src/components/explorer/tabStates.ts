import type { TabBufferSnapshot } from './EditorTab.js';

// Buffer snapshots for open editor tabs, keyed by path and then by the tab
// instance that reported them. The split editor can show one file in both
// groups — two EditorTabs, two buffers, one path (and one shared Monaco model,
// see monacoModelRefs.ts). Keying by path alone let closing either tab delete
// the entry while the other was still open, so its dirty dot and ⌘S vanished.
// Here a path's entry lives until the last tab showing it unmounts.
export type TabStates = Record<string, Record<string, TabBufferSnapshot>>;

/** Record `tabId`'s snapshot for `path`; it becomes the path's current one. */
export function putTabState(s: TabStates, path: string, tabId: string, snap: TabBufferSnapshot): TabStates {
  const forPath = { ...s[path] };
  // Re-insert last so insertion order tracks the most recent reporter.
  delete forPath[tabId];
  forPath[tabId] = snap;
  return { ...s, [path]: forPath };
}

/** Drop one tab's snapshot; the path is forgotten only when no tab remains. */
export function dropTabState(s: TabStates, path: string, tabId: string): TabStates {
  const forPath = s[path];
  if (!forPath || !(tabId in forPath)) return s;
  const rest = { ...forPath };
  delete rest[tabId];
  const next = { ...s };
  if (Object.keys(rest).length === 0) delete next[path];
  else next[path] = rest;
  return next;
}

/** The most recently reported snapshot for `path` (drives the save/reload chrome). */
export function tabStateFor(s: TabStates, path: string): TabBufferSnapshot | undefined {
  const forPath = s[path];
  if (!forPath) return undefined;
  const snaps = Object.values(forPath);
  return snaps[snaps.length - 1];
}

/** Path → dirty, true when any tab showing the path has unsaved edits. */
export function dirtyByPath(s: TabStates): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [path, forPath] of Object.entries(s)) {
    out[path] = Object.values(forPath).some((snap) => snap.dirty);
  }
  return out;
}
