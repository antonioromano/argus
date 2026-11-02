import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionGroup } from '@argus/shared';
import { useGroups } from './useGroups.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

// Deleting a group is pure client state, so Undo restores it exactly
// (plan 004 U6) — except members that moved to another group meanwhile.

const saveGroups = vi.fn(async () => {});
const g = (id: string, sessionIds: string[]): SessionGroup => ({ id, name: id.toUpperCase(), color: 'blue', collapsed: false, sessionIds });
let initial: SessionGroup[] = [];
vi.mock('../services/api.js', () => ({
  api: { getGroups: vi.fn(async () => initial), saveGroups: (...a: unknown[]) => saveGroups(...(a as [])) },
}));

let container: HTMLDivElement; let root: Root;
const probe: { hook?: ReturnType<typeof useGroups> } = {};
function Probe() {
  const hook = useGroups();
  useLayoutEffect(() => { probe.hook = hook; });
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  initial = [g('a', ['s1']), g('b', ['s2', 's3']), g('c', ['s4'])];
  saveGroups.mockClear();
  container = document.createElement('div'); document.body.appendChild(container);
  act(() => { root = createRoot(container); root.render(<Probe />); });
  await act(async () => { await Promise.resolve(); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

describe('restoreGroup', () => {
  it('puts a deleted group back at its index with its members, and saves', async () => {
    const b = probe.hook!.groups[1];
    act(() => probe.hook!.deleteGroup('b'));
    expect(probe.hook!.groups.map((x) => x.id)).toEqual(['a', 'c']);
    act(() => probe.hook!.restoreGroup(b, 1));
    expect(probe.hook!.groups.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(probe.hook!.groups[1].sessionIds).toEqual(['s2', 's3']);
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(saveGroups).toHaveBeenLastCalledWith(probe.hook!.groups);
  });

  it('skips members that joined another group in the meantime', () => {
    const b = probe.hook!.groups[1];
    act(() => probe.hook!.deleteGroup('b'));
    act(() => probe.hook!.assign('s3', 'c'));
    act(() => probe.hook!.restoreGroup(b, 1));
    expect(probe.hook!.groups.find((x) => x.id === 'b')!.sessionIds).toEqual(['s2']);
    expect(probe.hook!.groups.find((x) => x.id === 'c')!.sessionIds).toContain('s3');
  });

  it('is a no-op when the group already exists', () => {
    act(() => probe.hook!.restoreGroup(probe.hook!.groups[0], 2));
    expect(probe.hook!.groups.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});
