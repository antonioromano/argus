/* eslint-disable @typescript-eslint/no-explicit-any -- window/global test shims for the electron bridge + React act environment */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TerminalShell } from './TerminalShell.js';
import type { SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import { FontSettingsContext } from '../../context/font-settings-context.js';
import { terminalSelectionToClipboard } from '../../hooks/terminalCopy.js';

let copyListener: ((sessionId: string, text: string) => void) | undefined;

const api = {
  available: vi.fn().mockResolvedValue(true),
  attach: vi.fn().mockResolvedValue(true),
  setRect: vi.fn(),
  detach: vi.fn(),
  closeFindBar: vi.fn(),
  setTheme: vi.fn(),
  focusTerminal: vi.fn(),
  setResizeSuspended: vi.fn(),
  setFontSize: vi.fn(),
  onCopy: vi.fn((cb: (sessionId: string, text: string) => void) => { copyListener = cb; return () => { copyListener = undefined; }; }),
  writeClipboard: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  api.attach.mockResolvedValue(true);
  (window as any).electronNativeTerminal = api;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

const session = { id: 's1', status: 'idle' } as unknown as SessionInfo;
const socket = {} as Socket<any, any>;

function mount() {
  const c = document.createElement('div');
  document.body.appendChild(c);
  return createRoot(c);
}

describe('TerminalShellNativeHole — focus requests', () => {
  // Mosaic and Focus pass a counter that starts at 0. Treating 0 as a request
  // made every native tile take key focus on mount (and again once attached),
  // stealing it from whatever the user was typing in.
  it('a token of 0 is not a focus request', async () => {
    const root = mount();
    await act(async () => { root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative requestFocusToken={0} />); });
    expect(api.focusTerminal).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('a bumped token focuses the overlay', async () => {
    const root = mount();
    await act(async () => { root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative requestFocusToken={0} />); });
    await act(async () => { root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative requestFocusToken={1} />); });
    expect(api.focusTerminal).toHaveBeenCalledWith('s1');
    await act(async () => root.unmount());
  });

  it('autoFocus still focuses on mount', async () => {
    const root = mount();
    await act(async () => { root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative autoFocus requestFocusToken={0} />); });
    expect(api.focusTerminal).toHaveBeenCalledWith('s1');
    await act(async () => root.unmount());
  });
});

describe('TerminalShellNativeHole — divider drags', () => {
  it('holds the overlay\'s pty resizes for the duration of a drag', async () => {
    const root = mount();
    await act(async () => { root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative />); });
    expect(api.setResizeSuspended).not.toHaveBeenCalled();

    await act(async () => { root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative suspendResize />); });
    expect(api.setResizeSuspended).toHaveBeenLastCalledWith('s1', true);

    await act(async () => { root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative suspendResize={false} />); });
    expect(api.setResizeSuspended).toHaveBeenLastCalledWith('s1', false);
    await act(async () => root.unmount());
  });
});

describe('TerminalShellNativeHole — code font size', () => {
  it('follows the code font size setting', async () => {
    const root = mount();
    const tile = (size: number) => (
      <FontSettingsContext.Provider value={{ uiFontSize: 14, codeFontSize: size }}>
        <TerminalShell session={session} socket={socket} theme="dark" useNative />
      </FontSettingsContext.Provider>
    );
    await act(async () => { root.render(tile(13)); });
    await act(async () => { root.render(tile(17)); });
    expect(api.setFontSize).toHaveBeenLastCalledWith('s1', 17);
    await act(async () => root.unmount());
  });
});

describe('TerminalShellNativeHole — copy', () => {
  it('formats a native copy exactly as an xterm tile would', async () => {
    const root = mount();
    await act(async () => { root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative />); });
    // Gutter-indented rows the agent wrapped at 30 columns.
    const raw = '  The quick brown fox jumps over\n  the lazy dog.';
    copyListener?.('s1', raw);
    expect(api.writeClipboard).toHaveBeenCalledWith(terminalSelectionToClipboard(raw));
    expect(api.writeClipboard.mock.calls[0][0]).not.toContain('\n');
    await act(async () => root.unmount());
  });

  it('ignores copies for other sessions', async () => {
    const root = mount();
    await act(async () => { root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative />); });
    copyListener?.('other', 'x');
    expect(api.writeClipboard).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
