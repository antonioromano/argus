import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DirectoryEntry } from '@argus/shared';
import { useFileTree, type UseFileTreeResult } from './useFileTree.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('../services/api.js', () => ({
  api: { getDirectoryChildren: vi.fn() },
}));
vi.mock('../components/primitives/Toast.js', () => ({ pushToast: vi.fn() }));
const fakeSocket = { on: vi.fn(), off: vi.fn() };
vi.mock('./useSocket.js', () => ({ useSocket: () => fakeSocket }));

import { api } from '../services/api.js';
import { pushToast } from '../components/primitives/Toast.js';

const dirEntry = (path: string): DirectoryEntry =>
  ({ name: path.split('/').pop()!, path, isFile: false, hasChildren: true, ext: '' }) as DirectoryEntry;

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

let seq = 0;

describe('useFileTree fetch failures', () => {
  let container: HTMLDivElement;
  let root: Root;
  let tree: UseFileTreeResult;
  let sessionId: string;
  const unhandled = vi.fn();

  function Probe() {
    tree = useFileTree('/repo', sessionId);
    return null;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    process.on('unhandledRejection', unhandled);
    unhandled.mockReset();
    sessionId = `s${++seq}`; // fresh tree cache per test
    // The error-toast throttle is time-windowed; give each test its own window.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000 + seq * 60_000);
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); });
    vi.mocked(api.getDirectoryChildren).mockReset();
    vi.mocked(pushToast).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    process.off('unhandledRejection', unhandled);
    vi.useRealTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  async function mount() {
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
  }

  const node = (path: string) => tree.visibleNodes.find((n) => n.path === path);

  it('a failed folder fetch clears the spinner, marks the node errored and toasts', async () => {
    vi.mocked(api.getDirectoryChildren).mockResolvedValueOnce({ entries: [dirEntry('/repo/src')] } as never);
    await mount();
    expect(node('/repo/src')).toBeDefined();

    vi.mocked(api.getDirectoryChildren).mockRejectedValueOnce(new Error('EACCES'));
    await act(async () => {
      tree.toggle('/repo/src');
      await flush();
    });

    const src = node('/repo/src')!;
    expect(src.loading).toBe(false);
    expect(src.error).toBe(true);
    // Collapsed again so the next click retries the fetch.
    expect(src.expanded).toBe(false);
    expect(pushToast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pushToast).mock.calls[0][1]).toBe('danger');

    // Retry succeeds → error cleared.
    vi.mocked(api.getDirectoryChildren).mockResolvedValueOnce({ entries: [] } as never);
    await act(async () => {
      tree.toggle('/repo/src');
      await flush();
    });
    expect(node('/repo/src')!.error).toBeFalsy();
    expect(node('/repo/src')!.expanded).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('a failed root fetch ends the loading state without an unhandled rejection', async () => {
    vi.mocked(api.getDirectoryChildren).mockRejectedValueOnce(new Error('offline'));
    await mount();
    expect(tree.isLoading).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(unhandled).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledTimes(1);
  });

  it('many folders failing in one refresh raise a single toast', async () => {
    vi.mocked(api.getDirectoryChildren).mockResolvedValueOnce({ entries: [dirEntry('/repo/a'), dirEntry('/repo/b')] } as never);
    await mount();
    vi.mocked(api.getDirectoryChildren).mockResolvedValue({ entries: [] } as never);
    await act(async () => { tree.toggle('/repo/a'); await flush(); });
    await act(async () => { tree.toggle('/repo/b'); await flush(); });

    vi.mocked(api.getDirectoryChildren).mockRejectedValue(new Error('server down'));
    await act(async () => {
      tree.refresh();
      await flush();
    });
    expect(pushToast).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(unhandled).not.toHaveBeenCalled();
  });
});
