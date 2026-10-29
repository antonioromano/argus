import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AppearanceSnapshot } from '@argus/shared';
import { useSystemAppearance } from './useSystemAppearance.js';

type W = Window & { electronAppearance?: unknown };

const heights: number[] = [];

function fakeBridge(initial: AppearanceSnapshot | undefined) {
  let listener: ((s: unknown) => void) | null = null;
  const bridge = {
    snapshot: () => initial,
    onChange: (cb: (s: unknown) => void) => { listener = cb; return () => { listener = null; }; },
    setTheme: () => {},
    setTitlebarHeight: (px: number) => { heights.push(px); },
  };
  (window as W).electronAppearance = bridge;
  return { push: (s: AppearanceSnapshot) => listener?.(s), subscribed: () => listener !== null };
}

const root = () => document.documentElement;
const snap = (over: Partial<AppearanceSnapshot> = {}): AppearanceSnapshot =>
  ({ accent: '#0a84ff', material: 'translucent', contrast: 'normal', active: true, titlebarInset: 82, ...over });

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let reactRoot: Root | null = null;

/** Minimal renderHook: mounts a probe component that calls the hook. */
function renderHook<P>(hook: (props: P) => void, opts: { initialProps?: P } = {}) {
  function Probe({ p }: { p: P }) { hook(p); return null; }
  const r = createRoot(container);
  reactRoot = r;
  act(() => r.render(<Probe p={opts.initialProps as P} />));
  return {
    rerender: (p: P) => act(() => r.render(<Probe p={p} />)),
    unmount: () => { act(() => r.unmount()); reactRoot = null; },
  };
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (reactRoot) { const r = reactRoot; act(() => r.unmount()); reactRoot = null; }
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  delete (window as W).electronAppearance;
});

describe('useSystemAppearance', () => {
  it('writes the snapshot to <html> on mount', () => {
    fakeBridge(snap());
    renderHook(() => useSystemAppearance('dark'));
    expect(root().dataset.material).toBe('translucent');
    expect(root().dataset.contrast).toBe('normal');
    expect(root().dataset.windowActive).toBe('true');
    expect(root().style.getPropertyValue('--sys-accent-color')).toBe('#0a84ff');
    expect(root().style.getPropertyValue('--titlebar-inset')).toBe('82px');
  });

  it('reports the toolbar height so main can centre the traffic lights', () => {
    fakeBridge(snap());
    heights.length = 0;
    const { rerender } = renderHook(({ h }) => useSystemAppearance('dark', { titlebarH: h }), { initialProps: { h: 44 } });
    rerender({ h: 38 });
    expect(heights).toEqual([44, 38]);
  });

  it('follows appearance:changed pushes', () => {
    const b = fakeBridge(snap());
    renderHook(() => useSystemAppearance('dark'));
    act(() => b.push(snap({ material: 'solid', contrast: 'more', active: false })));
    expect(root().dataset.material).toBe('solid');
    expect(root().dataset.contrast).toBe('more');
    expect(root().dataset.windowActive).toBe('false');
  });

  it('drops a system accent that fails 3:1 on this theme, keeping the brand accent', () => {
    fakeBridge(snap({ accent: '#ffc600' }));
    const { rerender } = renderHook(({ theme }) => useSystemAppearance(theme), { initialProps: { theme: 'dark' as 'dark' | 'light' } });
    expect(root().style.getPropertyValue('--sys-accent-color')).toBe('#ffc600');
    rerender({ theme: 'light' });
    expect(root().style.getPropertyValue('--sys-accent-color')).toBe('');
  });

  it('forces solid when the user picked the Solid window setting', () => {
    fakeBridge(snap());
    renderHook(() => useSystemAppearance('dark', { windowMaterial: 'solid' }));
    expect(root().dataset.material).toBe('solid');
  });

  it('ignores a malformed push', () => {
    const b = fakeBridge(snap());
    renderHook(() => useSystemAppearance('dark'));
    act(() => b.push({ material: 'glass' } as unknown as AppearanceSnapshot));
    expect(root().dataset.material).toBe('translucent');
  });

  it('clears everything on unmount', () => {
    fakeBridge(snap());
    const { unmount } = renderHook(() => useSystemAppearance('dark'));
    unmount();
    expect(root().dataset.material).toBeUndefined();
    expect(root().dataset.contrast).toBeUndefined();
    expect(root().dataset.windowActive).toBeUndefined();
    expect(root().style.getPropertyValue('--sys-accent-color')).toBe('');
    expect(root().style.getPropertyValue('--titlebar-inset')).toBe('');
  });

  it('sets nothing without the Electron bridge (/mobile, browser), so materials stay solid', () => {
    renderHook(() => useSystemAppearance('dark'));
    expect(root().dataset.material).toBeUndefined();
    expect(root().dataset.windowActive).toBeUndefined();
  });
});
