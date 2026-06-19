import { describe, it, expect } from 'vitest';
import {
  initGroups,
  openInGroup,
  openPreviewInGroup,
  pinTab,
  activateTab,
  closeTab,
  splitToRight,
  moveTabToGroup,
  focusGroup,
  type EditorGroup,
  type GroupsState,
} from './editorGroups.js';

const mk = (tabs: string[], active: string | null, preview: string | null = null): EditorGroup => ({ tabs, active, preview });
const single = (tabs: string[], active: string | null, preview: string | null = null, focused = 0): GroupsState => ({
  groups: [mk(tabs, active, preview)],
  focused,
});
const two = (l: EditorGroup, r: EditorGroup, focused = 0): GroupsState => ({ groups: [l, r], focused });

describe('initGroups', () => {
  it('with no path → one empty group, focused 0', () => {
    expect(initGroups()).toEqual({ groups: [mk([], null)], focused: 0 });
  });
  it('with a path → one group holding+activating it (pinned, no preview)', () => {
    expect(initGroups('a.ts')).toEqual({ groups: [mk(['a.ts'], 'a.ts')], focused: 0 });
  });
});

describe('openInGroup (pinned)', () => {
  it('adds a new tab and activates it', () => {
    const s = openInGroup(single([], null), 0, 'a.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts'], 'a.ts'));
  });
  it('opening an already-open file activates it without duplicating', () => {
    const s = openInGroup(single(['a.ts', 'b.ts'], 'a.ts'), 0, 'b.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts', 'b.ts'], 'b.ts'));
  });
  it('focuses the target group', () => {
    const s = openInGroup(two(mk(['a.ts'], 'a.ts'), mk(['b.ts'], 'b.ts'), 0), 1, 'c.ts');
    expect(s.focused).toBe(1);
    expect(s.groups[1]).toEqual(mk(['b.ts', 'c.ts'], 'c.ts'));
  });
  it('pinning the current preview clears the preview slot (promotes it)', () => {
    const s = openInGroup(single(['a.ts'], 'a.ts', 'a.ts'), 0, 'a.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts'], 'a.ts', null));
  });
  it('opening a new pinned file leaves an existing preview in place', () => {
    const s = openInGroup(single(['a.ts'], 'a.ts', 'a.ts'), 0, 'b.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts', 'b.ts'], 'b.ts', 'a.ts'));
  });
});

describe('openPreviewInGroup', () => {
  it('opens a file in the reusable preview slot', () => {
    const s = openPreviewInGroup(single([], null), 0, 'a.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts'], 'a.ts', 'a.ts'));
  });
  it('a second preview replaces the first (old preview tab is dropped)', () => {
    const s = openPreviewInGroup(single(['a.ts'], 'a.ts', 'a.ts'), 0, 'b.ts');
    expect(s.groups[0]).toEqual(mk(['b.ts'], 'b.ts', 'b.ts'));
  });
  it('keeps pinned tabs when replacing the preview', () => {
    const s = openPreviewInGroup(single(['pinned.ts', 'a.ts'], 'a.ts', 'a.ts'), 0, 'b.ts');
    expect(s.groups[0]).toEqual(mk(['pinned.ts', 'b.ts'], 'b.ts', 'b.ts'));
  });
  it('previewing a file that is already a pinned tab just activates it (no preview set)', () => {
    const s = openPreviewInGroup(single(['a.ts', 'b.ts'], 'a.ts'), 0, 'b.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts', 'b.ts'], 'b.ts', null));
  });
  it('re-previewing the current preview is idempotent', () => {
    const s = openPreviewInGroup(single(['a.ts'], 'a.ts', 'a.ts'), 0, 'a.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts'], 'a.ts', 'a.ts'));
  });
});

describe('pinTab', () => {
  it('promotes the preview tab to a permanent tab', () => {
    const s = pinTab(single(['a.ts'], 'a.ts', 'a.ts'), 0, 'a.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts'], 'a.ts', null));
  });
  it('is a no-op on a non-preview tab', () => {
    const before = single(['a.ts', 'b.ts'], 'a.ts', 'b.ts');
    expect(pinTab(before, 0, 'a.ts')).toEqual(before);
  });
});

describe('activateTab', () => {
  it('sets the active tab without touching the preview slot', () => {
    const s = activateTab(single(['a.ts', 'b.ts'], 'a.ts', 'b.ts'), 0, 'b.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts', 'b.ts'], 'b.ts', 'b.ts'));
  });
});

describe('closeTab', () => {
  it('closing the active middle tab activates the left neighbor', () => {
    const s = closeTab(single(['a.ts', 'b.ts', 'c.ts'], 'b.ts'), 0, 'b.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts', 'c.ts'], 'a.ts'));
  });
  it('closing the preview tab clears the preview slot', () => {
    const s = closeTab(single(['a.ts', 'b.ts'], 'b.ts', 'b.ts'), 0, 'b.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts'], 'a.ts', null));
  });
  it('closing the last tab in the only group leaves one empty group', () => {
    const s = closeTab(single(['a.ts'], 'a.ts', 'a.ts'), 0, 'a.ts');
    expect(s).toEqual({ groups: [mk([], null)], focused: 0 });
  });
  it('emptying one of two groups collapses to the other, focused 0', () => {
    const s = closeTab(two(mk(['a.ts'], 'a.ts'), mk(['b.ts'], 'b.ts'), 1), 0, 'a.ts');
    expect(s).toEqual({ groups: [mk(['b.ts'], 'b.ts')], focused: 0 });
  });
});

describe('splitToRight', () => {
  it('moves a tab into a new pinned right group', () => {
    const s = splitToRight(single(['a.ts', 'b.ts', 'c.ts'], 'a.ts'), 0, 'c.ts');
    expect(s.groups).toEqual([mk(['a.ts', 'b.ts'], 'a.ts'), mk(['c.ts'], 'c.ts')]);
    expect(s.focused).toBe(1);
  });
  it('splitting the preview tab clears it from the source and pins it on the right', () => {
    const s = splitToRight(single(['a.ts', 'b.ts'], 'b.ts', 'b.ts'), 0, 'b.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts'], 'a.ts', null));
    expect(s.groups[1]).toEqual(mk(['b.ts'], 'b.ts', null));
  });
  it('is a no-op when the source has only one tab', () => {
    const before = single(['a.ts'], 'a.ts');
    expect(splitToRight(before, 0, 'a.ts')).toEqual(before);
  });
  it('is a no-op when already split', () => {
    const before = two(mk(['a.ts', 'b.ts'], 'a.ts'), mk(['c.ts'], 'c.ts'));
    expect(splitToRight(before, 0, 'b.ts')).toEqual(before);
  });
});

describe('moveTabToGroup', () => {
  it('moves a tab to the other group and pins it there', () => {
    const s = moveTabToGroup(two(mk(['a.ts', 'b.ts'], 'a.ts'), mk(['c.ts'], 'c.ts')), 0, 1, 'b.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts'], 'a.ts'));
    expect(s.groups[1]).toEqual(mk(['c.ts', 'b.ts'], 'b.ts'));
    expect(s.focused).toBe(1);
  });
  it('moving the last tab out of a group collapses the split', () => {
    const s = moveTabToGroup(two(mk(['a.ts', 'b.ts'], 'a.ts'), mk(['c.ts'], 'c.ts')), 1, 0, 'c.ts');
    expect(s).toEqual({ groups: [mk(['a.ts', 'b.ts', 'c.ts'], 'c.ts')], focused: 0 });
  });
  it('moving the preview tab clears it from the source', () => {
    const s = moveTabToGroup(two(mk(['a.ts', 'b.ts'], 'b.ts', 'b.ts'), mk(['c.ts'], 'c.ts')), 0, 1, 'b.ts');
    expect(s.groups[0]).toEqual(mk(['a.ts'], 'a.ts', null));
    expect(s.groups[1]).toEqual(mk(['c.ts', 'b.ts'], 'b.ts', null));
  });
});

describe('focusGroup', () => {
  it('sets the focused group index', () => {
    const s = focusGroup(two(mk(['a.ts'], 'a.ts'), mk(['b.ts'], 'b.ts'), 0), 1);
    expect(s.focused).toBe(1);
  });
});
