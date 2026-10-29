import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { NotificationsPane } from './NotificationsPane.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

let container: HTMLDivElement; let root: Root;
let onSave: ReturnType<typeof vi.fn>;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  onSave = vi.fn().mockResolvedValue(DEFAULT_CONFIG);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove();
  delete window.electronNotifications;
});

function render(config: Partial<AppConfig> = {}) {
  act(() => { root.render(<NotificationsPane config={{ ...DEFAULT_CONFIG, ...config }} onSave={onSave as never} />); });
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

describe('NotificationsPane — In-app tips', () => {
  it('the Show tips toggle saves showTips', () => {
    render();
    const row = container.querySelector('[data-setting-id="showTips"]') as HTMLElement;
    expect(row).toBeTruthy();
    const track = row.querySelector('label > span') as HTMLElement;
    act(() => track.click());
    expect(onSave).toHaveBeenCalledWith({ showTips: false });
  });

  it('"Show tips again" clears tipsSeen and tipLastShownAt and keeps the rest', () => {
    render({ discovery: { ...DEFAULT_CONFIG.discovery!, tipsSeen: ['broadcast'], tipLastShownAt: 99, used: ['inbox'], notifAskedAt: 5 } });
    act(() => button('Show tips again')!.click());
    expect(onSave).toHaveBeenCalledWith({
      discovery: { ...DEFAULT_CONFIG.discovery!, tipsSeen: [], tipLastShownAt: 0, used: ['inbox'], notifAskedAt: 5 },
    });
  });
});

describe('NotificationsPane — Open System Settings', () => {
  it('shows the button only when the bridge can open it, and opens the Notifications pane', () => {
    render();
    expect(button('Open System Settings')).toBeUndefined();
    const openSystemSettings = vi.fn();
    window.electronNotifications = { show: vi.fn(), close: vi.fn(), onClick: () => () => {}, openSystemSettings };
    render();
    act(() => button('Open System Settings')!.click());
    expect(openSystemSettings).toHaveBeenCalledWith('notifications');
  });
});
