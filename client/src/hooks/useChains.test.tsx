import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useChains } from './useChains.js';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../services/api.js', () => ({ api: { listChains: mocks.list } }));

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const handlers = new Map<string, () => void>();
const socket = {
  on: (e: string, fn: () => void) => { handlers.set(e, fn); },
  off: (e: string) => { handlers.delete(e); },
} as never;

const latest: { counts: Record<string, number> } = { counts: {} };
function Probe({ enabled }: { enabled: boolean }) {
  const { countsBySource } = useChains(enabled, socket);
  useEffect(() => { latest.counts = countsBySource; });
  return null;
}

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  handlers.clear();
  latest.counts = {};
  mocks.list.mockReset().mockResolvedValue([
    { id: '1', sourceId: 'a', targetId: 'b' }, { id: '2', sourceId: 'a', targetId: 'c' }, { id: '3', sourceId: 'b', targetId: 'a' },
  ]);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('useChains (beta F13)', () => {
  it('fetches nothing and listens to nothing while the flag is off', async () => {
    await act(async () => { root.render(<Probe enabled={false} />); });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
    expect(latest.counts).toEqual({});
  });

  it('counts chains per source and refetches on chains:changed', async () => {
    await act(async () => { root.render(<Probe enabled />); });
    expect(latest.counts).toEqual({ a: 2, b: 1 });
    mocks.list.mockResolvedValue([]);
    await act(async () => { handlers.get('chains:changed')!(); });
    expect(latest.counts).toEqual({});
  });

  it('turning the flag off clears the counts and the listener', async () => {
    await act(async () => { root.render(<Probe enabled />); });
    await act(async () => { root.render(<Probe enabled={false} />); });
    expect(latest.counts).toEqual({});
    expect(handlers.size).toBe(0);
  });
});
