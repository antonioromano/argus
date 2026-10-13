import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { useSessions } from './useSessions.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('../services/api.js', () => ({
  api: {
    getSessions: vi.fn(),
    createSession: vi.fn(),
    renameSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}));
vi.mock('../components/primitives/index.js', () => ({ pushToast: vi.fn() }));

import { api } from '../services/api.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

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

const sess = (id: string, over: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, name: id, status: 'idle', ...over }) as SessionInfo;

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('useSessions reconnect snapshot vs socket deltas', () => {
  let container: HTMLDivElement;
  let root: Root;
  let hook: ReturnType<typeof useSessions>;
  let socket: ReturnType<typeof createFakeSocket>;

  function Probe() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake socket
    hook = useSessions(socket as any);
    return null;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    socket = createFakeSocket();
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); });
    vi.mocked(api.getSessions).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  async function mountWith(initial: SessionInfo[]) {
    vi.mocked(api.getSessions).mockResolvedValueOnce(initial);
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
  }

  const byId = (id: string) => hook.sessions.find((s) => s.id === id);

  it('a status delta received while the reconnect GET is in flight survives the snapshot', async () => {
    await mountWith([sess('a', { status: 'idle' })]);

    const snap = deferred<SessionInfo[]>();
    vi.mocked(api.getSessions).mockReturnValueOnce(snap.promise);
    await act(async () => { socket.emit('connect'); });

    // Newer than the snapshot the server is about to return.
    await act(async () => { socket.emit('session:status', { sessionId: 'a', status: 'running' }); });
    expect(byId('a')!.status).toBe('running');

    await act(async () => {
      snap.resolve([sess('a', { status: 'idle' })]); // stale
      await flush();
    });
    expect(byId('a')!.status).toBe('running');
  });

  it('a session created / deleted during the GET is not undone by the snapshot', async () => {
    await mountWith([sess('a'), sess('b')]);
    const snap = deferred<SessionInfo[]>();
    vi.mocked(api.getSessions).mockReturnValueOnce(snap.promise);
    await act(async () => { socket.emit('connect'); });
    await act(async () => {
      socket.emit('session:created', sess('c'));
      socket.emit('session:deleted', { sessionId: 'b' });
    });
    await act(async () => {
      snap.resolve([sess('a'), sess('b')]);
      await flush();
    });
    expect(hook.sessions.map((s) => s.id).sort()).toEqual(['a', 'c']);
  });

  it('with no deltas in flight, the snapshot is authoritative', async () => {
    await mountWith([sess('a', { status: 'running' })]);
    vi.mocked(api.getSessions).mockResolvedValueOnce([sess('a', { status: 'idle' }), sess('z')]);
    await act(async () => {
      socket.emit('connect');
      await flush();
    });
    expect(byId('a')!.status).toBe('idle');
    expect(byId('z')).toBeDefined();
  });

  it('an older GET resolving after a newer one does not overwrite it', async () => {
    await mountWith([]);
    const older = deferred<SessionInfo[]>();
    const newer = deferred<SessionInfo[]>();
    vi.mocked(api.getSessions).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    await act(async () => { socket.emit('connect'); socket.emit('connect'); });
    await act(async () => { newer.resolve([sess('new')]); await flush(); });
    await act(async () => { older.resolve([sess('old')]); await flush(); });
    expect(hook.sessions.map((s) => s.id)).toEqual(['new']);
  });
});
