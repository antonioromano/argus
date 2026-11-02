import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { useSessions } from './useSessions.js';
import { getChatDraft, resetChatDraftsForTest, updateChatDraft } from '../app/ui/chat/chatDrafts.js';

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

  it('a status carries starting / initialPrompt while the session starts; their absence clears them (F15b)', async () => {
    await mountWith([sess('a', { status: 'running', starting: true, initialPrompt: { text: 'go' } })]);
    await act(async () => { socket.emit('session:status', { sessionId: 'a', status: 'waiting', starting: true, initialPrompt: { text: 'go' } }); });
    expect(byId('a')!.starting).toBe(true);
    expect(byId('a')!.initialPrompt).toEqual({ text: 'go' });
    await act(async () => { socket.emit('session:status', { sessionId: 'a', status: 'done' }); });
    expect(byId('a')!.starting).toBeUndefined();
    expect(byId('a')!.initialPrompt).toBeUndefined();
  });

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

describe('useSessions load errors and agent exits', () => {
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
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
    vi.restoreAllMocks();
  });

  async function mount() {
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
  }

  const byId = (id: string) => hook.sessions.find((s) => s.id === id);

  it('a failed initial fetch is an error, not "loaded with zero sessions"', async () => {
    vi.mocked(api.getSessions).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await mount();
    expect(hook.loaded).toBe(false);
    expect(hook.loadError).toBeTruthy();
    expect(hook.loadError).not.toMatch(/Failed to fetch/);
    expect(hook.sessions).toEqual([]);
  });

  it('a server-unreachable ApiError reads as the server not responding', async () => {
    vi.mocked(api.getSessions).mockRejectedValueOnce(Object.assign(new Error('Argus server unreachable'), { status: 0, code: 'SERVER_UNREACHABLE' }));
    await mount();
    expect(hook.loadError).toMatch(/isn’t responding/);
  });

  it('a successful fetch has no load error', async () => {
    vi.mocked(api.getSessions).mockResolvedValueOnce([sess('a')]);
    await mount();
    expect(hook.loaded).toBe(true);
    expect(hook.loadError).toBeNull();
  });

  it('retry() clears the error once the fetch succeeds', async () => {
    vi.mocked(api.getSessions).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await mount();
    expect(hook.loadError).toBeTruthy();

    vi.mocked(api.getSessions).mockResolvedValueOnce([sess('a')]);
    await act(async () => { hook.retry(); await flush(); });
    expect(hook.loadError).toBeNull();
    expect(hook.loaded).toBe(true);
    expect(hook.sessions.map((s) => s.id)).toEqual(['a']);
  });

  it('a failed retry keeps the error', async () => {
    vi.mocked(api.getSessions).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await mount();
    vi.mocked(api.getSessions).mockRejectedValueOnce(new Error('HTTP 500'));
    await act(async () => { hook.retry(); await flush(); });
    expect(hook.loadError).toBeTruthy();
    expect(hook.loaded).toBe(false);
  });

  it('a socket reconnect retries and clears the error on success', async () => {
    vi.mocked(api.getSessions).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await mount();
    vi.mocked(api.getSessions).mockResolvedValueOnce([sess('b')]);
    await act(async () => { socket.emit('connect'); await flush(); });
    expect(hook.loadError).toBeNull();
    expect(hook.loaded).toBe(true);
    expect(byId('b')).toBeDefined();
  });

  it('a failed reconnect after a good load does not raise a load error', async () => {
    vi.mocked(api.getSessions).mockResolvedValueOnce([sess('a')]);
    await mount();
    vi.mocked(api.getSessions).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => { socket.emit('connect'); await flush(); });
    expect(hook.loadError).toBeNull();
    expect(byId('a')).toBeDefined();
  });

  it('keeps the exit code and how long the agent ran since it was spawned', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    vi.mocked(api.getSessions).mockResolvedValueOnce([]);
    await mount();
    await act(async () => { socket.emit('session:created', sess('n', { status: 'running', createdAt: new Date(1_000_000).toISOString() })); });
    now.mockReturnValue(1_001_200);
    await act(async () => { socket.emit('session:exit', { sessionId: 'n', exitCode: 127 }); });
    expect(byId('n')!.status).toBe('exited');
    expect(byId('n')!.exitCode).toBe(127);
    expect(byId('n')!.exitedAfterMs).toBe(1200);
  });

  it('measures run time from createdAt for a session it did not see spawn', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    vi.mocked(api.getSessions).mockResolvedValueOnce([sess('old', { status: 'running', createdAt: new Date(1_000_000).toISOString() })]);
    await mount();
    now.mockReturnValue(2_000_000);
    await act(async () => { socket.emit('session:exit', { sessionId: 'old', exitCode: 127 }); });
    expect(byId('old')!.exitedAfterMs).toBe(1_000_000);
  });

  it('a restart (status leaves exited) clears the exit code and restarts the clock', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    vi.mocked(api.getSessions).mockResolvedValueOnce([sess('r', { status: 'running', createdAt: new Date(0).toISOString() })]);
    await mount();
    await act(async () => { socket.emit('session:exit', { sessionId: 'r', exitCode: 127 }); });
    expect(byId('r')!.exitCode).toBe(127);

    now.mockReturnValue(5_000_000);
    await act(async () => { socket.emit('session:status', { sessionId: 'r', status: 'running' }); });
    expect(byId('r')!.exitCode).toBeUndefined();
    expect(byId('r')!.exitedAfterMs).toBeUndefined();

    now.mockReturnValue(5_000_800);
    await act(async () => { socket.emit('session:exit', { sessionId: 'r', exitCode: 127 }); });
    expect(byId('r')!.exitedAfterMs).toBe(800);
  });

  it('a status event reporting exited does not drop the exit code', async () => {
    vi.mocked(api.getSessions).mockResolvedValueOnce([sess('e', { status: 'running', createdAt: new Date(0).toISOString() })]);
    await mount();
    await act(async () => { socket.emit('session:exit', { sessionId: 'e', exitCode: 1 }); });
    await act(async () => { socket.emit('session:status', { sessionId: 'e', status: 'exited' }); });
    expect(byId('e')!.exitCode).toBe(1);
  });

  it('a reconnect snapshot keeps the exit code of a still-exited session', async () => {
    vi.mocked(api.getSessions).mockResolvedValueOnce([sess('k', { status: 'running', createdAt: new Date(0).toISOString() })]);
    await mount();
    await act(async () => { socket.emit('session:exit', { sessionId: 'k', exitCode: 127 }); });
    vi.mocked(api.getSessions).mockResolvedValueOnce([sess('k', { status: 'exited', createdAt: new Date(0).toISOString() })]);
    await act(async () => { socket.emit('connect'); await flush(); });
    expect(byId('k')!.exitCode).toBe(127);
  });
});

describe('useSessions — chat drafts (F11)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const socket = createFakeSocket();

  function Probe() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake socket
    useSessions(socket as any);
    return null;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    resetChatDraftsForTest();
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

  it('keeps every draft when the first fetch fails, and drops gone sessions once one succeeds', async () => {
    updateChatDraft('a', () => ({ text: 'keep', attachments: [] }));
    updateChatDraft('gone', () => ({ text: 'drop', attachments: [] }));
    vi.mocked(api.getSessions).mockRejectedValueOnce(new Error('server down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
    expect(getChatDraft('a').text).toBe('keep');
    expect(getChatDraft('gone').text).toBe('drop');

    vi.mocked(api.getSessions).mockResolvedValueOnce([sess('a')]);
    await act(async () => {
      socket.emit('connect');
      await flush();
    });
    expect(getChatDraft('a').text).toBe('keep');
    expect(getChatDraft('gone').text).toBe('');
  });
});
