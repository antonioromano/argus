import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GitDiffResponse, DiffFileResponse } from '@argus/shared';
import { useGitDiff } from './useGitDiff.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

vi.mock('../services/api.js', () => ({
  api: {
    getSessionDiff: vi.fn(),
    getFileDiff: vi.fn(),
  },
}));

import { api } from '../services/api.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function resp(over: Partial<GitDiffResponse> = {}): GitDiffResponse {
  return { unstaged: '', staged: '', branch: '', untracked: [], untrackedDiff: '', ...over };
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('useGitDiff', () => {
  let container: HTMLDivElement;
  let root: Root;
  let hook: ReturnType<typeof useGitDiff>;

  function Probe() {
    hook = useGitDiff({ sessionId: 's1', isOpen: true, sessionStatus: 'idle' });
    return null;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); });
    vi.mocked(api.getSessionDiff).mockReset();
    vi.mocked(api.getFileDiff).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  async function mount() {
    await act(async () => {
      root.render(<Probe />);
      await flush();
    });
  }

  it('surfaces a newly untracked file even when tracked diffs are unchanged', async () => {
    vi.mocked(api.getSessionDiff).mockResolvedValueOnce(resp());
    await mount();
    expect(hook.diff?.untracked).toEqual([]);

    vi.mocked(api.getSessionDiff).mockResolvedValueOnce(resp({ untracked: ['new.ts'], untrackedDiff: '+x' }));
    await act(async () => { await hook.refresh(); });
    expect(hook.diff?.untracked).toEqual(['new.ts']);
    expect(hook.diff?.untrackedDiff).toBe('+x');
  });

  it('surfaces a change in the oversized list', async () => {
    vi.mocked(api.getSessionDiff).mockResolvedValueOnce(resp());
    await mount();
    vi.mocked(api.getSessionDiff).mockResolvedValueOnce(resp({ oversized: ['huge.json'] }));
    await act(async () => { await hook.refresh(); });
    expect(hook.diff?.oversized).toEqual(['huge.json']);
  });

  it('after an error, an identical clean diff replaces the error payload', async () => {
    vi.mocked(api.getSessionDiff).mockResolvedValueOnce(resp({ unstaged: 'A' }));
    await mount();
    vi.mocked(api.getSessionDiff).mockResolvedValueOnce(resp({ error: 'boom' }));
    await act(async () => { await hook.refresh(); });
    expect(hook.error).toBe('boom');
    vi.mocked(api.getSessionDiff).mockResolvedValueOnce(resp({ unstaged: 'A' }));
    await act(async () => { await hook.refresh(); });
    expect(hook.error).toBeNull();
    expect(hook.diff?.error).toBeUndefined();
    expect(hook.diff?.unstaged).toBe('A');
  });

  it('a refresh() during an in-flight fetch is not dropped: it queues one trailing refetch', async () => {
    vi.mocked(api.getSessionDiff).mockResolvedValueOnce(resp());
    await mount();

    const slow = deferred<GitDiffResponse>();
    vi.mocked(api.getSessionDiff).mockReturnValueOnce(slow.promise);
    let first!: Promise<void>;
    act(() => { first = hook.refresh(); });

    // User stages a file → refresh while the poll/fetch is still on the wire.
    vi.mocked(api.getSessionDiff).mockResolvedValueOnce(resp({ staged: 'STAGED' }));
    let second!: Promise<void>;
    let third!: Promise<void>;
    act(() => { second = hook.refresh(); third = hook.refresh(); });

    await act(async () => {
      slow.resolve(resp({ unstaged: 'OLD' }));
      await first;
      await second;
      await third;
    });
    expect(api.getSessionDiff).toHaveBeenCalledTimes(3); // mount + in-flight + ONE trailing
    expect(hook.diff?.staged).toBe('STAGED');
  });

  it('expandFileContext clears the spinner when getFileDiff rejects', async () => {
    vi.mocked(api.getSessionDiff).mockResolvedValueOnce(resp({ unstaged: 'diff --git a/x b/x\n' }));
    await mount();
    const d = deferred<DiffFileResponse>();
    vi.mocked(api.getFileDiff).mockReturnValueOnce(d.promise);
    act(() => hook.expandFileContext('x', 'unstaged'));
    expect(hook.expandingFiles.has('unstaged:x')).toBe(true);
    await act(async () => {
      d.reject(new Error('net'));
      await flush();
    });
    expect(hook.expandingFiles.has('unstaged:x')).toBe(false);
  });
});
