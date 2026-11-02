import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { useSessions } from './useSessions.js';
import { ToastProvider } from '../components/primitives/Toast.js';
import { deferUndoable } from '../utils/undoable.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Closing an exited session (plan 004 U5): hidden at once in this window, the
// DELETE goes out only when the Undo toast closes without Undo.

vi.mock('../services/api.js', () => {
  class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  }
  return {
    ApiError,
    api: { getSessions: vi.fn(), createSession: vi.fn(), renameSession: vi.fn(), deleteSession: vi.fn() },
  };
});
const prune = vi.fn();
vi.mock('./useFileTree.js', () => ({ pruneFileTreeCache: (ids: Set<string>) => prune(ids) }));

import { api, ApiError } from '../services/api.js';

const fakeSocket = { on() {}, off() {} };
const sess = (id: string, over: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, name: id, status: 'exited', ...over }) as SessionInfo;

let container: HTMLDivElement;
let root: Root;
const probe: { hook?: ReturnType<typeof useSessions> } = {};

function Probe() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake socket
  const hook = useSessions(fakeSocket as any);
  useLayoutEffect(() => { probe.hook = hook; });
  return null;
}

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const advance = async (ms: number) => {
  for (let t = 0; t < ms; t += 100) await act(async () => { vi.advanceTimersByTime(Math.min(100, ms - t)); });
};
const undoButton = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Undo');
const ids = () => probe.hook!.sessions.map((s) => s.id);

/** What ArgusApp.requestKill does for an exited session. */
function closeExited(id: string) {
  deferUndoable({
    message: `Closed ${id}`,
    apply: () => probe.hook!.hideSession(id),
    commit: () => probe.hook!.commitClose(id),
    revert: () => probe.hook!.unhideSession(id),
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(api.getSessions).mockResolvedValue([sess('a'), sess('b')]);
  vi.mocked(api.deleteSession).mockReset().mockResolvedValue(undefined);
  prune.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
  act(() => { root.render(<ToastProvider><Probe /></ToastProvider>); });
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  vi.useRealTimers();
});

describe('pending close', () => {
  it('hides the session at once but keeps its file-tree cache', async () => {
    act(() => closeExited('a'));
    await flush();
    expect(ids()).toEqual(['b']);
    const lastPrune = prune.mock.calls.at(-1)?.[0] as Set<string>;
    expect(lastPrune.has('a')).toBe(true);
  });

  it('Undo brings it back and never sends DELETE', async () => {
    act(() => closeExited('a'));
    await flush();
    act(() => undoButton()!.click());
    await flush();
    await advance(7000);
    expect(ids()).toEqual(['a', 'b']);
    expect(api.deleteSession).not.toHaveBeenCalled();
  });

  it('the toast timing out sends exactly one DELETE and drops the session', async () => {
    act(() => closeExited('a'));
    await flush();
    await advance(5900);
    expect(api.deleteSession).not.toHaveBeenCalled();
    await advance(400);
    await flush();
    expect(api.deleteSession).toHaveBeenCalledTimes(1);
    expect(api.deleteSession).toHaveBeenCalledWith('a');
    expect(ids()).toEqual(['b']);
  });

  it('a 404 on commit (closed elsewhere) counts as closed', async () => {
    vi.mocked(api.deleteSession).mockRejectedValue(new ApiError(404, 'Session not found'));
    act(() => closeExited('a'));
    await flush();
    await advance(6500);
    await flush();
    expect(ids()).toEqual(['b']);
    expect(container.textContent).not.toContain('Couldn');
  });

  it('a failed commit brings the session back and says so', async () => {
    vi.mocked(api.deleteSession).mockRejectedValue(new ApiError(500, 'daemon down'));
    act(() => closeExited('a'));
    await flush();
    await advance(6500);
    await flush();
    expect(ids()).toEqual(['a', 'b']);
    expect(container.textContent).toContain('daemon down');
  });
});

describe('deleteSession result', () => {
  // ArgusApp offers "Reopen" for a closed live session only when this is true:
  // a failed kill leaves the agent running, and Reopen would start a second one
  // on the same conversation.
  it('resolves true once the session is gone', async () => {
    let ok: boolean | undefined;
    await act(async () => { ok = await probe.hook!.deleteSession('a'); });
    expect(ok).toBe(true);
    expect(ids()).toEqual(['b']);
  });

  it('resolves false, keeps the session and says why when the kill fails', async () => {
    vi.mocked(api.deleteSession).mockRejectedValue(new ApiError(500, 'kill failed'));
    let ok: boolean | undefined;
    await act(async () => { ok = await probe.hook!.deleteSession('a'); });
    expect(ok).toBe(false);
    expect(ids()).toEqual(['a', 'b']);
    expect(container.textContent).toContain('kill failed');
  });
});
