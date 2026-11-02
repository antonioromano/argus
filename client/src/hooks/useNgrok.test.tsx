import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NgrokStatus } from '@argus/shared';
import { useNgrok } from './useNgrok.js';
import { api } from '../services/api.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('../services/api.js', () => ({
  api: {
    getNgrokStatus: vi.fn(),
    startNgrok: vi.fn(),
    stopNgrok: vi.fn(),
    recheckNgrok: vi.fn(),
  },
  setToken: vi.fn(),
}));

const offline: NgrokStatus = {
  installed: true,
  tunnelStatus: 'disconnected',
  publicUrl: null,
  error: null,
  platform: 'darwin',
  authRequired: false,
};
const online: NgrokStatus = {
  ...offline,
  tunnelStatus: 'connected',
  publicUrl: 'https://abc.ngrok.app',
  authRequired: true,
};

/** Just enough of a socket.io client to register and fire listeners. */
function fakeSocket() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
    },
    fire(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
  };
}

type Hook = ReturnType<typeof useNgrok>;
let hook: Hook;
function Harness({ socket, onRender }: { socket: ReturnType<typeof fakeSocket>; onRender: (h: Hook) => void }) {
  onRender(useNgrok(socket as unknown as Parameters<typeof useNgrok>[0]));
  return null;
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

let container: HTMLDivElement;
let root: Root;
let socket: ReturnType<typeof fakeSocket>;

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(api.getNgrokStatus).mockResolvedValue(offline);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  socket = fakeSocket();
  await act(async () => {
    root.render(<Harness socket={socket} onRender={(h) => { hook = h; }} />);
    await flush();
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('useNgrok', () => {
  it('shows the tunnel once start resolves, even if the connected broadcast was missed', async () => {
    // Starting the tunnel sets the password, which drops this window's socket
    // before ngrok broadcasts `connected` — the broadcast never arrives.
    vi.mocked(api.startNgrok).mockResolvedValue({ publicUrl: online.publicUrl!, token: 't' });
    vi.mocked(api.getNgrokStatus).mockResolvedValue(online);

    await act(async () => {
      await hook.startTunnel('correct horse battery');
      await flush();
    });

    expect(hook.status?.tunnelStatus).toBe('connected');
    expect(hook.status?.publicUrl).toBe(online.publicUrl);
  });

  it('refetches status when the socket reconnects', async () => {
    expect(hook.status?.tunnelStatus).toBe('disconnected');
    vi.mocked(api.getNgrokStatus).mockResolvedValue(online);

    await act(async () => {
      socket.fire('connect');
      await flush();
    });

    expect(hook.status?.tunnelStatus).toBe('connected');
  });

  it('stops listening for reconnects after unmount', async () => {
    act(() => root.unmount());
    vi.mocked(api.getNgrokStatus).mockClear();

    socket.fire('connect');

    expect(api.getNgrokStatus).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});
