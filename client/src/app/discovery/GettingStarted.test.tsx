import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DiscoveryState } from '@argus/shared';
import { GettingStarted, type GettingStartedProps } from './GettingStarted.js';
import { EMPTY_DISCOVERY } from './discoveryState.js';
import { openChecklist } from './discoveryCommands.js';
import type { DiscoveryApi } from './useDiscovery.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

function fakeDisc(initial: DiscoveryState) {
  const disc: DiscoveryApi = {
    discovery: initial,
    patch: vi.fn(async (fn) => { disc.discovery = fn(disc.discovery); }),
  };
  return disc;
}

const started = { ...EMPTY_DISCOVERY, checklistStartedAt: 1 };

function render(over: Partial<GettingStartedProps> & { disc: DiscoveryApi }) {
  const props: GettingStartedProps = {
    isMainWindow: true, liveCount: 1, notificationsEnabled: false, tunnelStatus: undefined, onAction: vi.fn(), ...over,
  };
  act(() => root.render(<GettingStarted {...props} />));
  return props;
}
const rows = () => [...container.querySelectorAll('.argus-checklist-row')] as HTMLElement[];
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;

describe('GettingStarted', () => {
  it('renders the four items with their done state', () => {
    render({ disc: fakeDisc({ ...started, checklistDone: ['inbox'] }) });
    expect(rows()).toHaveLength(4);
    expect(rows().map((r) => r.hasAttribute('data-done'))).toEqual([false, true, false, false]);
    expect(container.textContent).toContain('1 of 4');
  });

  it('is not shown to a user who never started it (upgrading users)', () => {
    render({ disc: fakeDisc(EMPTY_DISCOVERY), liveCount: 3 });
    expect(container.querySelector('.argus-checklist')).toBeNull();
  });

  it('is not rendered in a secondary window', () => {
    render({ disc: fakeDisc(started), isMainWindow: false });
    expect(container.querySelector('.argus-checklist')).toBeNull();
  });

  it('item actions call the handler with the item id', () => {
    const props = render({ disc: fakeDisc(started) });
    act(() => button('Start one').click());
    act(() => button('Set up').click());
    expect((props.onAction as ReturnType<typeof vi.fn>).mock.calls).toEqual([['two-sessions'], ['remote']]);
  });

  it('× stamps checklistDismissed', () => {
    const disc = fakeDisc(started);
    render({ disc });
    act(() => button('Hide checklist').click());
    expect(disc.discovery.checklistDismissed).toBe(true);
  });

  it('auto-ticks once per new item, with no write loop on re-render', () => {
    const disc = fakeDisc(started);
    const props = render({ disc, liveCount: 2 });
    expect(disc.patch).toHaveBeenCalledTimes(1);
    expect(disc.discovery.checklistDone).toEqual(['two-sessions']);
    render({ ...props, disc: { ...disc } });
    render({ ...props, disc: { ...disc } });
    expect(disc.patch).toHaveBeenCalledTimes(1);
  });

  it('shows "You’re set" after the last tick, then hides', () => {
    vi.useFakeTimers();
    const disc = fakeDisc({ ...started, checklistDone: ['two-sessions', 'inbox', 'notifications'] });
    const props = render({ disc });
    render({ ...props, disc: { ...disc, discovery: { ...disc.discovery, checklistDone: ['two-sessions', 'inbox', 'notifications', 'remote'] } } });
    expect(container.textContent).toContain('You’re set');
    act(() => { vi.advanceTimersByTime(4000); });
    expect(container.querySelector('.argus-checklist')).toBeNull();
  });

  it('registers openChecklist, which starts and un-hides it', () => {
    const disc = fakeDisc({ ...EMPTY_DISCOVERY, checklistDismissed: true });
    render({ disc });
    act(() => openChecklist());
    expect(disc.discovery.checklistStartedAt).toBeGreaterThan(0);
    expect(disc.discovery.checklistDismissed).toBe(false);
  });

  it('collapsed: shows a rail row with the count that expands the sidebar', () => {
    const onExpand = vi.fn();
    render({ disc: fakeDisc({ ...started, checklistDone: ['inbox'] }), collapsed: true, onExpand });
    expect(container.querySelector('.argus-checklist')).toBeNull();
    act(() => button('Getting started · 1 of 4').click());
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it('collapsed: no rail row once dismissed', () => {
    render({ disc: fakeDisc({ ...started, checklistDismissed: true }), collapsed: true });
    expect(container.querySelector('.argus-checklist-rail')).toBeNull();
  });
});
