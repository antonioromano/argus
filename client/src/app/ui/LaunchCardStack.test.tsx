import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PendingLaunchView } from '@argus/shared';
import {
  registerOverlay, setSuppressionTransport, resetOverlayRegistryForTests,
} from '../../hooks/nativeOverlayRegistry.js';
import { LaunchCardStack } from './LaunchCardStack.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const view: PendingLaunchView = {
  id: 'id-1', source: 'new', label: 'x', agent: 'claude', folder: '/tmp/x', args: [], command: 'claude',
  warnings: [], state: 'pending', receivedAt: 0, canSaveAsLauncher: true,
};
const view2: PendingLaunchView = { ...view, id: 'id-2', agent: 'codex', folder: '/tmp/newest', receivedAt: 5 };

let container: HTMLDivElement; let root: Root;
let pending: PendingLaunchView[];
let roCallback: (() => void) | null = null;
const disconnect = vi.fn();
let hidden: string[]; let shown: string[];
// jsdom has no layout: the stack's rect is whatever this says.
let stackRect = { x: 600, y: 64, width: 460, height: 300 };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  roCallback = null; disconnect.mockClear(); pending = [view];
  stackRect = { x: 600, y: 64, width: 460, height: 300 };
  resetOverlayRegistryForTests();
  hidden = []; shown = [];
  setSuppressionTransport({ hide: (id) => hidden.push(id), show: (id) => shown.push(id) });
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { roCallback = cb; } observe() {} unobserve() {} disconnect = disconnect; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const r = this.getAttribute('aria-label') === 'Pending launches' ? stackRect : { x: 0, y: 0, width: 0, height: 0 };
    return { ...r, top: r.y, left: r.x, right: r.x + r.width, bottom: r.y + r.height, toJSON() {} } as DOMRect;
  });
  (window as unknown as { electronLaunch: unknown }).electronLaunch = {
    list: async () => pending, onChanged: () => () => {}, onToast: () => () => {}, approve: async () => ({ ok: true }), discard: async () => {},
  };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove();
  delete (window as unknown as { electronLaunch?: unknown }).electronLaunch;
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

describe('LaunchCardStack', () => {
  it('I1: keeps native overlays hidden under the stack as tiles register, move and the window resizes', async () => {
    vi.useFakeTimers();
    registerOverlay('under', { x: 700, y: 100, width: 200, height: 200 });
    registerOverlay('left', { x: 0, y: 100, width: 200, height: 200 });
    await act(async () => { root.render(<LaunchCardStack />); });
    expect(hidden).toEqual(['under']);

    registerOverlay('late', { x: 800, y: 200, width: 100, height: 100 });   // new session under the card
    expect(hidden).toEqual(['under', 'late']);

    registerOverlay('under', { x: 100, y: 400, width: 200, height: 200 });  // reflow out from under it
    expect(shown).toEqual(['under']);

    stackRect = { x: 50, y: 64, width: 460, height: 300 };                  // window narrowed: stack moved
    window.dispatchEvent(new Event('resize'));
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(hidden).toContain('left');

    stackRect = { x: 50, y: 64, width: 460, height: 700 };                  // stack grew (content)
    expect(roCallback).not.toBeNull();
    await act(async () => { roCallback!(); vi.advanceTimersByTime(50); });
    expect(hidden.filter((h) => h === 'under')).toHaveLength(2);           // re-covered after growth

    act(() => root.unmount());
    expect(disconnect).toHaveBeenCalled();
    expect(shown.sort()).toEqual(['late', 'left', 'under', 'under']);
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

  it('M9: the assertive live region announces only the newest card, not the whole stack', async () => {
    pending = [view, view2];
    await act(async () => { root.render(<LaunchCardStack />); });
    const stack = container.querySelector('[aria-label="Pending launches"]') as HTMLElement;
    expect(stack.getAttribute('aria-live')).toBeNull();
    const live = container.querySelectorAll('[aria-live="assertive"]');
    expect(live).toHaveLength(1);
    expect(live[0].textContent).toBe('Launch request: codex in /tmp/newest');
  });
});
