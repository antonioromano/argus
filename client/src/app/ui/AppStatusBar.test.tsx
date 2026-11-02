import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppStatusBar, type AppStatusBarProps } from './AppStatusBar.js';
import { connectionState } from './connectionState.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function props(over: Partial<AppStatusBarProps> = {}): AppStatusBarProps {
  return {
    socketConnected: true,
    health: { kind: 'daemon', state: 'ok' },
    waiting: 0,
    running: 0,
    onOpenInbox: vi.fn(),
    remoteOn: false,
    onOpenRemote: vi.fn(),
    keepAwakeStatus: { active: false, expiresAt: null, indefinite: false },
    onArmKeepAwake: vi.fn(),
    onDisarmKeepAwake: vi.fn(),
    onOpenUpdate: vi.fn(),
    showClock: false,
    clockShowSeconds: false,
    ...over,
  };
}

const render = (p: AppStatusBarProps) => act(() => root.render(<AppStatusBar {...p} />));
const text = () => container.textContent ?? '';
const buttonWith = (t: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(t))!;

describe('connectionState', () => {
  it('the socket outranks the daemon; null health reads as fine', () => {
    expect(connectionState(false, { kind: 'daemon', state: 'down' }).label).toBe('Reconnecting…');
    expect(connectionState(true, null)).toMatchObject({ label: 'Connected', tone: 'ok' });
  });

  it('maps each daemon state to a tone', () => {
    expect(connectionState(true, { kind: 'daemon', state: 'down' })).toMatchObject({ label: 'Daemon down', tone: 'danger' });
    expect(connectionState(true, { kind: 'daemon', state: 'reconnecting' }).tone).toBe('warn');
    expect(connectionState(true, { kind: 'daemon', state: 'drain' }).tone).toBe('warn');
    expect(connectionState(true, { kind: 'tmux', state: 'ok' }).hint).toMatch(/tmux/);
  });
});

describe('AppStatusBar', () => {
  it('is a status landmark showing connection and an idle session line', () => {
    render(props());
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(text()).toContain('Connected');
    expect(text()).toContain('No session running');
    expect(text()).toContain('Remote: off');
  });

  it('a down daemon shows in the danger tone', () => {
    render(props({ health: { kind: 'daemon', state: 'down' } }));
    const conn = container.querySelector('[data-testid="statusbar-connection"]')!;
    expect(conn.textContent).toContain('Daemon down');
    expect(conn.getAttribute('data-tone')).toBe('danger');
  });

  it('counts waiting and running, and a click opens the inbox', () => {
    const p = props({ waiting: 3, running: 2 });
    render(p);
    const counts = buttonWith('3 waiting · 2 running');
    expect(counts.getAttribute('data-tone')).toBe('warn');
    act(() => counts.click());
    expect(p.onOpenInbox).toHaveBeenCalled();
  });

  it('remote, update, clock and version render from their props', () => {
    const p = props({ remoteOn: true, updateVersion: '0.31.0', showClock: true, version: '0.30.1' });
    render(p);
    expect(buttonWith('Remote: on').getAttribute('data-tone')).toBe('accent');
    act(() => buttonWith('v0.31.0 available').click());
    expect(p.onOpenUpdate).toHaveBeenCalled();
    act(() => buttonWith('Remote: on').click());
    expect(p.onOpenRemote).toHaveBeenCalled();
    expect(text()).toMatch(/\d\d:\d\d/);
    expect(text()).toContain('v0.30.1');
  });

  it('reserves room for the toast stack while mounted, and gives it back on unmount', () => {
    render(props());
    expect(document.documentElement.style.getPropertyValue('--statusbar-offset')).toBe('var(--h-statusbar)');
    act(() => root.render(<></>));
    expect(document.documentElement.style.getPropertyValue('--statusbar-offset')).toBe('');
  });
});
