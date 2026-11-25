import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal renderHook: a probe component exposing the hook's latest return. */
function renderHook<T>(hook: () => T) {
  const result = { current: null as unknown as T };
  function Probe() {
    result.current = hook();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe />));
  return { result };
}

const check = vi.hoisted(() => ({ impl: () => Promise.resolve({}) as Promise<unknown> }));
vi.mock('../services/api.js', () => ({ api: { checkUpdate: () => check.impl() } }));

import { useUpdate } from './useUpdate.js';

const socket = { on: vi.fn(), off: vi.fn() } as never;
afterEach(() => { vi.useRealTimers(); });

describe('useUpdate checkSettled', () => {
  it('settles when the check answers', async () => {
    check.impl = () => Promise.resolve({ currentVersion: '1.0.0' });
    const { result } = renderHook(() => useUpdate(socket));
    await act(async () => {});
    expect(result.current.checkSettled).toBe(true);
    expect(result.current.status).toEqual({ currentVersion: '1.0.0' });
  });

  it('settles when the check fails, with no status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    check.impl = () => Promise.reject(new Error('offline'));
    const { result } = renderHook(() => useUpdate(socket));
    await act(async () => {});
    expect(result.current.checkSettled).toBe(true);
    expect(result.current.status).toBeNull();
  });

  it('settles after a timeout when the check hangs', async () => {
    vi.useFakeTimers();
    check.impl = () => new Promise(() => {});
    const { result } = renderHook(() => useUpdate(socket));
    expect(result.current.checkSettled).toBe(false);
    await act(async () => { vi.advanceTimersByTime(8000); });
    expect(result.current.checkSettled).toBe(true);
  });
});
