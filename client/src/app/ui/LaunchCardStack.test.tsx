import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PendingLaunchView } from '@argus/shared';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const suppressMounts = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../hooks/useOverlaySuppression.js', () => ({
  useOverlaySuppression: () => { useEffect(() => { suppressMounts.n += 1; }, []); },
}));

import { LaunchCardStack } from './LaunchCardStack.js';

const view: PendingLaunchView = {
  id: 'id-1', source: 'new', label: 'x', agent: 'claude', folder: '/tmp/x', args: [], command: 'claude',
  warnings: [], state: 'pending', receivedAt: 0, canSaveAsLauncher: true,
};

let container: HTMLDivElement; let root: Root;
let roCallback: (() => void) | null = null;
const disconnect = vi.fn();

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  suppressMounts.n = 0; roCallback = null; disconnect.mockClear();
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { roCallback = cb; } observe() {} unobserve() {} disconnect = disconnect; });
  (window as unknown as { electronLaunch: unknown }).electronLaunch = {
    list: async () => [view], onChanged: () => () => {}, onToast: () => () => {}, approve: async () => ({ ok: true }), discard: async () => {},
  };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove();
  delete (window as unknown as { electronLaunch?: unknown }).electronLaunch;
  vi.unstubAllGlobals();
});

describe('LaunchCardStack', () => {
  it('re-suppresses native overlays when the stack resizes, and disconnects on unmount', async () => {
    await act(async () => { root.render(<LaunchCardStack />); });
    const before = suppressMounts.n;
    expect(before).toBeGreaterThan(0);
    expect(roCallback).not.toBeNull();
    await act(async () => { roCallback!(); });
    expect(suppressMounts.n).toBeGreaterThan(before);
    act(() => root.unmount());
    expect(disconnect).toHaveBeenCalled();
    root = createRoot(container);
  });

  it('caps its height to the viewport and scrolls', async () => {
    await act(async () => { root.render(<LaunchCardStack />); });
    const stack = container.querySelector('[aria-label="Pending launches"]') as HTMLElement;
    // jsdom reorders calc terms, so assert the parts
    expect(stack.style.maxHeight).toContain('100vh');
    expect(stack.style.maxHeight).toContain('64px');
    expect(stack.style.overflowY).toBe('auto');
  });
});
