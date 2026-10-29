import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AppConfig, DiscoveryState, SessionStatus } from '@argus/shared';
import { useNotificationAsk, type NotificationAskApi, type UseNotificationAskArgs } from './useNotificationAsk.js';
import { EMPTY_DISCOVERY } from './discoveryState.js';
import type { DiscoveryApi } from './useDiscovery.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;
/** Every render's hook result; the latest is the live one. */
const results: NotificationAskApi[] = [];
const latest = () => results[results.length - 1];
const bridge = { show: vi.fn(), close: vi.fn(), onClick: vi.fn(() => () => {}), openSystemSettings: vi.fn() };

function fakeDisc(initial: DiscoveryState = EMPTY_DISCOVERY) {
  const disc: DiscoveryApi = {
    discovery: initial,
    patch: vi.fn(async (fn) => { disc.discovery = fn(disc.discovery); }),
  };
  return disc;
}

function Harness(props: UseNotificationAskArgs) {
  results.push(useNotificationAsk(props));
  return null;
}

const sess = (status: SessionStatus) => [{ id: 's1', status }];

function render(over: Partial<UseNotificationAskArgs> & { disc: DiscoveryApi }) {
  const props: UseNotificationAskArgs = {
    sessions: [], ownsSession: () => true, notificationsEnabled: false, isMainWindow: true, blocked: false,
    updateConfig: vi.fn(async () => ({}) as AppConfig), now: () => 1234, ...over,
  };
  act(() => root.render(<Harness {...props} />));
  return props;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.electronNotifications = bridge;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  delete window.electronNotifications;
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('useNotificationAsk', () => {
  it('asks on the first running → waiting and stamps notifAskedAt + tipLastShownAt', () => {
    const disc = fakeDisc();
    const props = render({ disc, sessions: sess('running') });
    expect(latest().phase).toBeNull();
    render({ ...props, disc, sessions: sess('waiting') });
    expect(latest().phase).toBe('ask');
    expect(disc.discovery.notifAskedAt).toBe(1234);
    expect(disc.discovery.tipLastShownAt).toBe(1234);
  });

  it('does not ask when a session is first seen already waiting', () => {
    const disc = fakeDisc();
    render({ disc, sessions: sess('waiting') });
    expect(latest().phase).toBeNull();
  });

  it('"Turn on" saves the setting and posts one confirmation with a UUID id', async () => {
    const disc = fakeDisc();
    const props = render({ disc, sessions: sess('running') });
    render({ ...props, disc, sessions: sess('waiting') });
    await act(async () => { await latest().turnOn(); });
    expect(props.updateConfig).toHaveBeenCalledWith({ notificationsEnabled: true });
    expect(bridge.show).toHaveBeenCalledTimes(1);
    expect(bridge.show.mock.calls[0][0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(latest().phase).toBe('followup');
  });

  it('the follow-up offers System Settings and goes away on its own', () => {
    vi.useFakeTimers();
    const disc = fakeDisc();
    const props = render({ disc, sessions: sess('running') });
    render({ ...props, disc, sessions: sess('waiting') });
    act(() => { void latest().turnOn(); });
    act(() => latest().openSystemSettings());
    expect(bridge.openSystemSettings).toHaveBeenCalledWith('notifications');
    act(() => { vi.advanceTimersByTime(8000); });
    expect(latest().phase).toBeNull();
  });

  it('"Not now" closes, and an already-asked user is never asked again after remount', () => {
    const disc = fakeDisc();
    const props = render({ disc, sessions: sess('running') });
    render({ ...props, disc, sessions: sess('waiting') });
    act(() => latest().close());
    expect(latest().phase).toBeNull();
    act(() => root.unmount());
    act(() => { root = createRoot(container); });
    const again = render({ ...props, disc, sessions: sess('running') });
    render({ ...again, disc, sessions: sess('waiting') });
    expect(latest().phase).toBeNull();
  });

  it('a secondary window never asks or writes', () => {
    const disc = fakeDisc();
    const props = render({ disc, sessions: sess('running'), isMainWindow: false });
    render({ ...props, disc, sessions: sess('waiting') });
    expect(latest().phase).toBeNull();
    expect(disc.patch).not.toHaveBeenCalled();
  });
});
