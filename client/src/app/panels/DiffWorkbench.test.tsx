import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo } from '@argus/shared';
import { ToastProvider } from '../../components/primitives/Toast.js';
import { ApiError } from '../../services/api.js';
import { DiffWorkbench } from './DiffWorkbench.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const discardPatch = vi.fn();
const undoDiscard = vi.fn();
vi.mock('../../services/api.js', async (orig) => ({
  ...(await orig<typeof import('../../services/api.js')>()),
  api: {
    discardPatch: (...a: unknown[]) => discardPatch(...a),
    undoDiscard: (...a: unknown[]) => undoDiscard(...a),
  },
}));

const refresh = vi.fn(async () => {});
const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  ' keep',
  '-old line',
  '+new line',
  '',
].join('\n');
vi.mock('../../hooks/useGitDiff.js', () => ({
  useGitDiff: () => ({ diff: { unstaged: DIFF, staged: '', untrackedDiff: '' }, isLoading: false, error: null, refresh }),
}));
vi.mock('../../hooks/useCommitSelection.js', () => ({
  useCommitSelection: () => ({
    state: { version: 1, files: [] },
    isChecked: () => false,
    toggle: vi.fn(),
    uncheck: vi.fn(),
    setBlocksForFile: vi.fn(),
    clearForFiles: vi.fn(),
    gcStale: vi.fn(),
    checkedHashesByFile: new Map(),
    totalChecked: 0,
  }),
}));

let container: HTMLDivElement;
let root: Root;
const originalIO = globalThis.IntersectionObserver;

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.IntersectionObserver = class {
    private cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
    observe(target: Element) { this.cb([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IntersectionObserver = originalIO;
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
});

const session: SessionInfo = {
  id: 's1', name: 'billing', folderPath: '/repo', status: 'idle', createdAt: new Date().toISOString(), agentType: 'claude', flags: [],
};

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const advance = async (ms: number) => {
  for (let t = 0; t < ms; t += 100) await act(async () => { vi.advanceTimersByTime(Math.min(100, ms - t)); });
};
const byText = (text: string) =>
  Array.from(container.querySelectorAll<HTMLElement>('button, [role="button"]')).find((b) => b.textContent?.trim() === text);

async function render() {
  act(() => {
    root.render(
      <ToastProvider>
        <DiffWorkbench session={session} onClose={() => {}} />
      </ToastProvider>,
    );
  });
  await flush();
}

describe('DiffWorkbench revert', () => {
  it('reverts with no confirm, then Undo redeems the undo id and refreshes', async () => {
    discardPatch.mockResolvedValue({ success: true, undoId: 'u-1' });
    undoDiscard.mockResolvedValue({ success: true });
    await render();

    act(() => { byText('ROLLBACK')!.click(); });
    await flush();

    expect(discardPatch).toHaveBeenCalledTimes(1);
    expect(discardPatch.mock.calls[0][1]).toMatchObject({ filePath: 'src/a.ts', source: 'unstaged' });
    expect(container.textContent).not.toContain('Don’t ask again');
    expect(container.textContent).toContain('Reverted a.ts');
    refresh.mockClear();

    act(() => { byText('Undo')!.click(); });
    await flush();
    expect(undoDiscard).toHaveBeenCalledWith('s1', 'u-1');
    expect(refresh).toHaveBeenCalled();
  });

  it('keeps the Undo offer for 10 seconds', async () => {
    discardPatch.mockResolvedValue({ success: true, undoId: 'u-2' });
    await render();
    act(() => { byText('ROLLBACK')!.click(); });
    await flush();

    await advance(9000);
    expect(byText('Undo')).toBeTruthy();
    await advance(1500);
    expect(byText('Undo')).toBeUndefined();
    expect(undoDiscard).not.toHaveBeenCalled();
  });

  it('a failed discard shows an inline error and offers no Undo', async () => {
    discardPatch.mockRejectedValue(new ApiError(400, 'patch does not apply'));
    await render();
    act(() => { byText('ROLLBACK')!.click(); });
    await flush();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('patch does not apply');
    expect(byText('Undo')).toBeUndefined();
  });

  it('an expired undo surfaces the server reason', async () => {
    discardPatch.mockResolvedValue({ success: true, undoId: 'u-3' });
    undoDiscard.mockRejectedValue(new ApiError(404, 'Undo window expired or not found'));
    await render();
    act(() => { byText('ROLLBACK')!.click(); });
    await flush();
    act(() => { byText('Undo')!.click(); });
    await flush();
    expect(container.textContent).toContain('Undo window expired or not found');
  });

  it('retires the old skip-confirm preference on load', async () => {
    localStorage.setItem('argus.revert.skipConfirm', '1');
    vi.resetModules();
    await import('./DiffWorkbench.js');
    expect(localStorage.getItem('argus.revert.skipConfirm')).toBeNull();
  });
});
