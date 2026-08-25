import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { WindowRegistryState } from '@argus/shared';
import { computeOwnerOf, computeLabelOf, computeIsForeign, useWindows, type WindowsApi } from './useWindows.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('../services/api.js', () => ({
  api: {
    getWindows: vi.fn(),
    createWindow: vi.fn(),
    assignWindow: vi.fn(),
    mergeAllWindows: vi.fn(),
    focusWindow: vi.fn(),
  },
}));

import { api } from '../services/api.js';

const MAIN = { id: 'main', label: 'Main', isMain: true, createdAt: 0 };
const W2 = { id: 'w2', label: 'Window 2', isMain: false, createdAt: 1 };

function stateWith(...windows: typeof MAIN[]): WindowRegistryState {
  return { windows, assignments: {} };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/** Minimal fake socket.io-client Socket: enough surface for on/off/emit. */
function createFakeSocket() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on: (event: string, cb: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(cb);
    },
    off: (event: string, cb: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(cb);
    },
    emit: (event: string, ...args: unknown[]) => {
      handlers.get(event)?.forEach((cb) => cb(...args));
    },
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake stands in for the typed Socket
type FakeSocket = any;

describe('computeOwnerOf / computeLabelOf / computeIsForeign (pure helpers)', () => {
  const state: WindowRegistryState = { windows: [MAIN, W2], assignments: { s1: 'w2' } };

  it('ownerOf: assigned session returns its window, unassigned defaults to main', () => {
    expect(computeOwnerOf(state, 's1')).toBe('w2');
    expect(computeOwnerOf(state, 'unknown-session')).toBe('main');
  });

  it('labelOf: known window returns its label, unknown falls back to Main', () => {
    expect(computeLabelOf(state, 'w2')).toBe('Window 2');
    expect(computeLabelOf(state, 'nope')).toBe('Main');
  });

  it('isForeign: compares owner against myWindowId once loaded', () => {
    expect(computeIsForeign(state, 's1', 'w2', true)).toBe(false);
    expect(computeIsForeign(state, 's1', 'main', true)).toBe(true);
    expect(computeIsForeign(state, 'unassigned', 'main', true)).toBe(false);
  });

  it('isForeign: defaults to false (not foreign) before the registry has loaded', () => {
    // Safe default — must not read as foreign before assignments are known,
    // or a secondary window would falsely treat its own sessions as foreign.
    expect(computeIsForeign(state, 's1', 'main', false)).toBe(false);
  });
});

describe('useWindows hook (fake socket + mocked api)', () => {
  let container: HTMLDivElement;
  let root: Root;
  let captured: WindowsApi | null;

  function Probe({ socket }: { socket: FakeSocket }) {
    captured = useWindows(socket);
    return null;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); });
    captured = null;
    vi.mocked(api.getWindows).mockReset();
    vi.mocked(api.createWindow).mockReset();
    vi.mocked(api.assignWindow).mockReset();
    vi.mocked(api.mergeAllWindows).mockReset();
    vi.mocked(api.focusWindow).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('fetches on mount and populates windows + loaded once it resolves', async () => {
    vi.mocked(api.getWindows).mockResolvedValue(stateWith(MAIN, W2));
    const socket = createFakeSocket();

    await act(async () => {
      root.render(<Probe socket={socket} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.getWindows).toHaveBeenCalledTimes(1);
    expect(captured!.loaded).toBe(true);
    expect(captured!.windows).toHaveLength(2);
  });

  it('loaded stays false until the first fetch resolves', async () => {
    const d = deferred<WindowRegistryState>();
    vi.mocked(api.getWindows).mockReturnValue(d.promise);
    const socket = createFakeSocket();

    await act(async () => {
      root.render(<Probe socket={socket} />);
    });
    expect(captured!.loaded).toBe(false);

    await act(async () => {
      d.resolve(stateWith(MAIN));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(captured!.loaded).toBe(true);
  });

  it('a window:state broadcast updates state and marks loaded, even before the fetch resolves', async () => {
    const d = deferred<WindowRegistryState>();
    vi.mocked(api.getWindows).mockReturnValue(d.promise);
    const socket = createFakeSocket();

    await act(async () => {
      root.render(<Probe socket={socket} />);
    });
    expect(captured!.loaded).toBe(false);

    await act(async () => {
      socket.emit('window:state', stateWith(MAIN, W2));
    });
    expect(captured!.loaded).toBe(true);
    expect(captured!.windows).toHaveLength(2);
  });

  it('refetches when the socket reconnects (mirrors useSessions)', async () => {
    vi.mocked(api.getWindows).mockResolvedValueOnce(stateWith(MAIN));
    const socket = createFakeSocket();

    await act(async () => {
      root.render(<Probe socket={socket} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.getWindows).toHaveBeenCalledTimes(1);
    expect(captured!.windows).toHaveLength(1);

    vi.mocked(api.getWindows).mockResolvedValueOnce(stateWith(MAIN, W2));
    await act(async () => {
      socket.emit('connect');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.getWindows).toHaveBeenCalledTimes(2);
    expect(captured!.windows).toHaveLength(2);
  });

  it('cleans up connect/window:state listeners on unmount', async () => {
    vi.mocked(api.getWindows).mockResolvedValue(stateWith(MAIN));
    const socket = createFakeSocket();

    await act(async () => {
      root.render(<Probe socket={socket} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => root.unmount());

    const callsBefore = vi.mocked(api.getWindows).mock.calls.length;
    socket.emit('connect');
    expect(vi.mocked(api.getWindows).mock.calls.length).toBe(callsBefore);
  });
});
