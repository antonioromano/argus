import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo, SessionPrDiffResponse, SessionPrEntry } from '@argus/shared';
import { PrDiffView } from './PrDiffView.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getSessionPrDiff = vi.fn();
vi.mock('../../services/api.js', () => ({
  api: { getSessionPrDiff: (...a: unknown[]) => getSessionPrDiff(...a) },
}));
const openExternal = vi.fn();
vi.mock('../../utils/openExternal.js', () => ({ openExternal: (u: string) => openExternal(u) }));

let container: HTMLDivElement;
let root: Root;
const originalIO = globalThis.IntersectionObserver;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Every observed section is "near", so diff bodies mount.
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
  vi.clearAllMocks();
});

const session: SessionInfo = {
  id: 's1', name: 'billing', folderPath: '/repo', status: 'idle', createdAt: new Date().toISOString(), agentType: 'claude', flags: [],
};
const URL = 'https://github.com/o/r/pull/7';
const entry: SessionPrEntry = {
  url: URL,
  pr: { number: 7, state: 'open', url: URL, ci: 'success', branch: 'feat/a', title: 'Add billing export', mergeable: 'mergeable' },
  folderBranch: true,
  linked: true,
};
const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  ' keep',
  '-old line',
  '+new line',
  'diff --git a/src/b.ts b/src/b.ts',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/src/b.ts',
  '@@ -0,0 +1 @@',
  '+hello',
  '',
].join('\n');

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

async function render(over: Partial<SessionPrDiffResponse> = {}, e: SessionPrEntry = entry) {
  getSessionPrDiff.mockResolvedValue({ url: URL, diff: DIFF, ...over });
  const onClose = vi.fn();
  await act(async () => { root.render(<PrDiffView session={session} entry={e} onClose={onClose} />); });
  await flush();
  return { onClose };
}

const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const fileRows = () => [...container.querySelectorAll('.argus-rodiff-file-path')].map((n) => n.textContent);

describe('PrDiffView', () => {
  it('reads the PR diff for the session and lists every changed file', async () => {
    await render();
    expect(getSessionPrDiff).toHaveBeenCalledWith('s1', URL);
    expect(fileRows()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(container.textContent).toContain('new line');
  });

  it('shows the PR title, owner/repo#n and state in the header', async () => {
    await render();
    const head = container.querySelector('.argus-prdiff-head')!;
    expect(head.querySelector('.argus-prdiff-title')?.textContent).toBe('Add billing export');
    expect(head.querySelector('.argus-prdiff-ref')?.textContent).toBe('o/r#7');
    expect(head.querySelector('[data-tone="ready"]')?.textContent).toBe('Open');
  });

  it('falls back to owner/repo#n when gh could not read the PR', async () => {
    await render({}, { ...entry, pr: null });
    expect(container.querySelector('.argus-prdiff-title')?.textContent).toBe('o/r#7');
    expect(container.querySelector('.argus-prdiff-ref')).toBeNull();
  });

  it('toggles split / unified and opens the PR on GitHub', async () => {
    await render();
    const [split, unified] = [...container.querySelectorAll<HTMLButtonElement>('.argus-prdiff-mode > button')];
    expect(split.getAttribute('aria-pressed')).toBe('true');
    act(() => unified.click());
    expect(unified.getAttribute('aria-pressed')).toBe('true');
    act(() => button('Open on GitHub').click());
    expect(openExternal).toHaveBeenCalledWith(URL);
  });

  it('a diff over the limit lists the changed paths instead', async () => {
    await render({ diff: '', truncated: { files: ['big/a.bin', 'big/b.json'], limitBytes: 8 * 1024 * 1024 } });
    const note = container.querySelector('[role="note"]')!;
    expect(note.textContent).toContain('larger than 8 MB');
    expect([...note.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['big/a.bin', 'big/b.json']);
    expect(container.textContent).toContain('too large to display');
  });

  it('shows the server error with a retry that reads again', async () => {
    getSessionPrDiff.mockRejectedValueOnce(new Error('GitHub CLI (gh) is missing or not logged in'));
    getSessionPrDiff.mockResolvedValue({ url: URL, diff: DIFF });
    await act(async () => { root.render(<PrDiffView session={session} entry={entry} onClose={() => {}} />); });
    await flush();
    expect(container.textContent).toContain('gh) is missing');
    const retry = [...container.querySelectorAll('button')].find((b) => /retry/i.test(b.textContent ?? ''))!;
    await act(async () => { retry.click(); });
    await flush();
    expect(getSessionPrDiff).toHaveBeenCalledTimes(2);
    expect(fileRows()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('Refresh reads again but keeps the diff on screen meanwhile', async () => {
    await render();
    let release!: (v: SessionPrDiffResponse) => void;
    getSessionPrDiff.mockReturnValueOnce(new Promise((r) => { release = r; }));
    act(() => button('Refresh').click());
    expect(getSessionPrDiff).toHaveBeenCalledTimes(2);
    expect(fileRows()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(container.textContent).not.toContain('Loading pull request changes');
    await act(async () => { release({ url: URL, diff: DIFF.replaceAll('src/b.ts', 'src/c.ts') }); });
    await flush();
    expect(fileRows()).toEqual(['src/a.ts', 'src/c.ts']);
  });

  it('Close returns to the shell', async () => {
    const { onClose } = await render();
    act(() => button('Close').click());
    expect(onClose).toHaveBeenCalled();
  });
});
