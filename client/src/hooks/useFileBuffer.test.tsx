import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFileBuffer, type UseFileBufferResult } from './useFileBuffer.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('../services/api.js', () => ({
  api: {
    getFileContent: vi.fn(),
    writeFile: vi.fn(),
  },
}));
vi.mock('../components/primitives/Toast.js', () => ({ pushToast: vi.fn() }));

import { api } from '../services/api.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

type WriteRes = Awaited<ReturnType<typeof api.writeFile>>;

describe('useFileBuffer', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let buf: UseFileBufferResult | null;

  function Probe({ filePath }: { filePath: string | null }) {
    buf = useFileBuffer({ sessionId: 's1', filePath });
    return null;
  }

  async function mount(filePath: string) {
    await act(async () => {
      root.render(<Probe filePath={filePath} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); });
    mounted = true;
    buf = null;
    vi.mocked(api.getFileContent).mockReset();
    vi.mocked(api.writeFile).mockReset();
    vi.mocked(api.getFileContent).mockResolvedValue({ content: 'v0', mtimeMs: 1, truncated: false } as Awaited<ReturnType<typeof api.getFileContent>>);
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
    vi.useRealTimers();
  });

  it('keeps an edit typed during an in-flight save dirty (not silently marked clean)', async () => {
    await mount('/a.txt');
    expect(buf!.content).toBe('v0');

    const write = deferred<WriteRes>();
    vi.mocked(api.writeFile).mockReturnValueOnce(write.promise);

    act(() => buf!.setContent('v1'));
    let savePromise!: Promise<void>;
    act(() => { savePromise = buf!.save(); });
    expect(api.writeFile).toHaveBeenCalledWith(expect.objectContaining({ content: 'v1' }));

    // User keeps typing while the write is on the wire.
    act(() => buf!.setContent('v2'));

    await act(async () => {
      write.resolve({ success: true, mtimeMs: 2 } as WriteRes);
      await savePromise;
    });

    expect(buf!.content).toBe('v2');
    expect(buf!.initialContent).toBe('v1');
    expect(buf!.dirty).toBe(true);
    expect(buf!.saving).toBe(false);
  });

  it('a clean save (no typing in flight) ends clean', async () => {
    await mount('/a.txt');
    vi.mocked(api.writeFile).mockResolvedValueOnce({ success: true, mtimeMs: 2 } as WriteRes);
    act(() => buf!.setContent('v1'));
    await act(async () => { await buf!.save(); });
    expect(buf!.dirty).toBe(false);
    expect(buf!.initialContent).toBe('v1');
  });

  it('re-arms autosave for the edit typed during an in-flight save', async () => {
    await mount('/a.txt');
    const write = deferred<WriteRes>();
    vi.mocked(api.writeFile).mockReturnValueOnce(write.promise);
    act(() => buf!.setContent('v1'));
    let savePromise!: Promise<void>;
    act(() => { savePromise = buf!.save(); });
    act(() => buf!.setContent('v2'));
    // The v2 autosave timer fires while v1 is still saving — it must not be lost.
    await act(async () => { vi.advanceTimersByTime(5000); });
    vi.mocked(api.writeFile).mockResolvedValueOnce({ success: true, mtimeMs: 3 } as WriteRes);
    await act(async () => {
      write.resolve({ success: true, mtimeMs: 2 } as WriteRes);
      await savePromise;
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.writeFile).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.writeFile).mock.calls[1][0]).toMatchObject({ content: 'v2', originalMtimeMs: 2 });
    expect(buf!.dirty).toBe(false);
  });

  it('flushes a pending edit exactly once on unmount', async () => {
    await mount('/a.txt');
    vi.mocked(api.writeFile).mockResolvedValue({ success: true, mtimeMs: 2 } as WriteRes);
    act(() => buf!.setContent('v1'));
    act(() => root.unmount());
    mounted = false;
    expect(api.writeFile).toHaveBeenCalledTimes(1);
    expect(api.writeFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/a.txt', content: 'v1' }));
  });
});
