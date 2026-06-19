// Pure state machine for the Explorer editor groups (tabs + two-column split +
// VS Code-style preview tabs). Kept free of React so it can be unit-tested in
// isolation, mirroring the reducer-style pattern in app/state/useAppView.ts.
// The React hook (useEditorGroups) is a thin wrapper over these functions.

export interface EditorGroup {
  /** Open file paths, in tab order. */
  tabs: string[];
  /** Currently-shown tab in this group, or null when the group is empty. */
  active: string | null;
  /** The single reusable "preview" tab (rendered italic), or null. A new
   *  single-click replaces it; double-click / editing promotes it to pinned. */
  preview: string | null;
}

export interface GroupsState {
  /** Length 1 (single column) or 2 (split). */
  groups: EditorGroup[];
  /** Index of the focused group — drives header chrome and where opens land. */
  focused: number;
}

/** Pick the active tab after a removal at index `idx` — prefer the left neighbor. */
function activeAfterRemoval(tabs: string[], idx: number): string | null {
  return tabs[idx - 1] ?? tabs[idx] ?? null;
}

function withGroups(groups: EditorGroup[], focused: number): GroupsState {
  return { groups, focused };
}

/** Drop an empty second group, if any, and clamp focus back to 0. */
function collapseEmpty(groups: EditorGroup[], focused: number): GroupsState {
  if (groups.length === 2) {
    const emptyIdx = groups.findIndex((g) => g.tabs.length === 0);
    if (emptyIdx >= 0) {
      return { groups: groups.filter((_, i) => i !== emptyIdx), focused: 0 };
    }
  }
  return { groups, focused };
}

export function initGroups(initialPath?: string | null): GroupsState {
  return initialPath
    ? { groups: [{ tabs: [initialPath], active: initialPath, preview: null }], focused: 0 }
    : { groups: [{ tabs: [], active: null, preview: null }], focused: 0 };
}

/** Open (or activate) a file as a permanent, pinned tab. */
export function openInGroup(state: GroupsState, gi: number, path: string): GroupsState {
  const groups = state.groups.map((g, i) => {
    if (i !== gi) return g;
    const tabs = g.tabs.includes(path) ? g.tabs : [...g.tabs, path];
    // If this file was the preview, opening it pinned promotes it.
    const preview = g.preview === path ? null : g.preview;
    return { tabs, active: path, preview };
  });
  return withGroups(groups, gi);
}

/** Open a file in the reusable preview slot (single-click from the tree). */
export function openPreviewInGroup(state: GroupsState, gi: number, path: string): GroupsState {
  const groups = state.groups.map((g, i) => {
    if (i !== gi) return g;
    // Already a pinned tab, or already the preview → just activate it.
    if ((g.tabs.includes(path) && g.preview !== path) || g.preview === path) {
      return { ...g, active: path };
    }
    // Replace the old preview tab (if any) with this one.
    const base = g.preview ? g.tabs.filter((p) => p !== g.preview) : g.tabs;
    const tabs = base.includes(path) ? base : [...base, path];
    return { tabs, active: path, preview: path };
  });
  return withGroups(groups, gi);
}

/** Promote the preview tab to a permanent tab. No-op if `path` isn't the preview. */
export function pinTab(state: GroupsState, gi: number, path: string): GroupsState {
  const groups = state.groups.map((g, i) =>
    i === gi && g.preview === path ? { ...g, preview: null } : g,
  );
  return withGroups(groups, state.focused);
}

export function activateTab(state: GroupsState, gi: number, path: string): GroupsState {
  const groups = state.groups.map((g, i) => (i === gi ? { ...g, active: path } : g));
  return withGroups(groups, gi);
}

export function closeTab(state: GroupsState, gi: number, path: string): GroupsState {
  const target = state.groups[gi];
  if (!target) return state;
  const idx = target.tabs.indexOf(path);
  if (idx < 0) return state;
  const tabs = target.tabs.filter((p) => p !== path);
  const active = target.active === path ? activeAfterRemoval(tabs, idx) : target.active;
  const preview = target.preview === path ? null : target.preview;
  const groups = state.groups.map((g, i) => (i === gi ? { tabs, active, preview } : g));
  return collapseEmpty(groups, state.focused);
}

export function focusGroup(state: GroupsState, gi: number): GroupsState {
  if (gi < 0 || gi >= state.groups.length) return state;
  return { ...state, focused: gi };
}

/**
 * Split the single column into two by moving `path` into a fresh right group.
 * No-op when already split (max two groups) or when the source has only the one
 * tab (splitting it would just empty the source). The moved tab becomes pinned.
 */
export function splitToRight(state: GroupsState, gi: number, path: string): GroupsState {
  if (state.groups.length !== 1) return state;
  const src = state.groups[gi];
  if (!src || src.tabs.length <= 1 || !src.tabs.includes(path)) return state;
  const idx = src.tabs.indexOf(path);
  const remaining = src.tabs.filter((p) => p !== path);
  const srcActive = src.active === path ? activeAfterRemoval(remaining, idx) : src.active;
  const srcPreview = src.preview === path ? null : src.preview;
  return {
    groups: [
      { tabs: remaining, active: srcActive, preview: srcPreview },
      { tabs: [path], active: path, preview: null },
    ],
    focused: 1,
  };
}

/** Move `path` from `fromGi` to `toGi` (pinned there); collapse if the source empties. */
export function moveTabToGroup(state: GroupsState, fromGi: number, toGi: number, path: string): GroupsState {
  if (fromGi === toGi) return activateTab(state, toGi, path);
  const from = state.groups[fromGi];
  const to = state.groups[toGi];
  if (!from || !to || !from.tabs.includes(path)) return state;
  const idx = from.tabs.indexOf(path);
  const fromTabs = from.tabs.filter((p) => p !== path);
  const fromActive = from.active === path ? activeAfterRemoval(fromTabs, idx) : from.active;
  const fromPreview = from.preview === path ? null : from.preview;
  const toTabs = to.tabs.includes(path) ? to.tabs : [...to.tabs, path];
  const toPreview = to.preview === path ? null : to.preview;
  const groups = state.groups.map((g, i) => {
    if (i === fromGi) return { tabs: fromTabs, active: fromActive, preview: fromPreview };
    if (i === toGi) return { tabs: toTabs, active: path, preview: toPreview };
    return g;
  });
  return collapseEmpty(groups, toGi);
}
