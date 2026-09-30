/* eslint-disable @typescript-eslint/no-explicit-any -- window/global test shims for the electron bridge + React act environment */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TerminalShell } from './TerminalShell.js';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';

// TerminalShellNativeHole's contract for SwiftTerm's own find bar. Opening is
// deliberately NOT this component's job (see useTerminal.search.test.ts) —
// these tests pin the boundary: this component must never call openFindBar
// itself (that would silently reintroduce the state-gating bug), and it must
// still close the bar on the transitions it does own.
const api = {
  available: vi.fn().mockResolvedValue(true),
  attach: vi.fn().mockResolvedValue(true),
  setRect: vi.fn(),
  detach: vi.fn(),
  openFindBar: vi.fn(),
  closeFindBar: vi.fn(),
  setTheme: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  api.attach.mockResolvedValue(true);
  (window as any).electronNativeTerminal = api;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

const session = { id: 's1', status: 'idle' } as unknown as SessionInfo;
const socket = {} as Socket<any, any>;

function renderNativeTile(searchOpen: boolean) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative searchOpen={searchOpen} onCloseSearch={() => {}} />));
  return root;
}

describe('TerminalShellNativeHole — find-bar open/close boundary', () => {
  it('never calls openFindBar itself, regardless of how many times searchOpen is (re-)rendered true', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative searchOpen={false} onCloseSearch={() => {}} />));
    act(() => root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative searchOpen onCloseSearch={() => {}} />));
    act(() => root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative searchOpen onCloseSearch={() => {}} />));
    // The bug this guards against: opening used to be gated on this exact
    // prop's dependency array, so a second identical `searchOpen` render
    // (the shape a stale-after-native-Escape re-open takes) never re-fired
    // an open call anyway — but also never should have lived here at all.
    expect(api.openFindBar).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('closes the native find bar when searchOpen transitions to false', () => {
    const root = renderNativeTile(true);
    expect(api.closeFindBar).not.toHaveBeenCalled();
    act(() => root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative searchOpen={false} onCloseSearch={() => {}} />));
    expect(api.closeFindBar).toHaveBeenCalledWith('s1');
    act(() => root.unmount());
  });

  it('closes the native find bar on unmount, so a torn-down tile cannot leave one open on a reused overlay id', () => {
    const root = renderNativeTile(true);
    api.closeFindBar.mockClear();
    act(() => root.unmount());
    expect(api.closeFindBar).toHaveBeenCalledWith('s1');
  });
});
