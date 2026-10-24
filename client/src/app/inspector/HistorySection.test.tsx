import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GitCommitSummary, SessionInfo } from '@argus/shared';
import { HistoryBody, HISTORY_CARD_COMMITS } from './HistorySection.js';
import type { InspectorContext } from './types.js';
import { GIT_HISTORY_POLL_MS } from '../../hooks/useGitHistory.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getGitHistory = vi.fn();
vi.mock('../../services/api.js', () => ({
  api: { getGitHistory: (...a: unknown[]) => getGitHistory(...a) },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  vi.clearAllMocks();
});

const NOW = Date.now();
const session: SessionInfo = {
  id: 's1', name: 'billing', folderPath: '/repo', status: 'idle', createdAt: new Date().toISOString(), agentType: 'claude', flags: [],
};

const c = (n: number, over: Partial<GitCommitSummary> = {}): GitCommitSummary => ({
  hash: `${n}`.repeat(40), shortHash: `${n}`.repeat(7), parents: ['0'.repeat(40)], authorName: 'Ada', authorEmail: 'a@x',
  authorDate: NOW - n * 60_000 * 5, subject: `commit ${n}`, refs: [], ...over,
});

function ctx(over: Partial<InspectorContext> = {}): InspectorContext {
  return { usageMeter: null, prStatusEnabled: true, onOpenDiff: vi.fn(), onOpenGit: vi.fn(), ...over };
}

async function render(context: InspectorContext) {
  await act(async () => { root.render(<HistoryBody session={session} ctx={context} />); });
}

describe('Inspector History card', () => {
  it('lists the latest commits; a commit opens the Git Manager on it', async () => {
    getGitHistory.mockResolvedValue({
      commits: [c(1, { refs: [{ kind: 'branch', name: 'main', current: true }] }), c(2, { parents: ['a'.repeat(40), 'b'.repeat(40)], subject: 'Merge feat' })],
      hasMore: true,
    });
    const context = ctx();
    await render(context);
    expect(getGitHistory).toHaveBeenCalledWith('s1', { limit: HISTORY_CARD_COMMITS, ref: undefined });
    const rows = container.querySelectorAll<HTMLButtonElement>('.argus-inspector-commit');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('commit 1');
    expect(rows[0].textContent).toContain('1111111');
    expect(rows[0].textContent).toContain('5m ago');
    expect(rows[0].textContent).toContain('main');
    await act(async () => { rows[1].click(); });
    expect(context.onOpenGit).toHaveBeenCalledWith('s1', { commit: '2'.repeat(40) });
  });

  it('links to the full history, the branches and the worktrees', async () => {
    getGitHistory.mockResolvedValue({ commits: [c(1)], hasMore: true });
    const context = ctx();
    await render(context);
    const links = Array.from(container.querySelectorAll<HTMLButtonElement>('.argus-inspector-links button'));
    expect(links.map((l) => l.textContent)).toEqual(['All history', 'Branches', 'Worktrees']);
    for (const l of links) await act(async () => { l.click(); });
    expect(context.onOpenGit).toHaveBeenNthCalledWith(1, 's1');
    expect(context.onOpenGit).toHaveBeenNthCalledWith(2, 's1', { tab: 'branches' });
    expect(context.onOpenGit).toHaveBeenNthCalledWith(3, 's1', { tab: 'worktrees' });
  });

  it('without a Git Manager to open, rows are inert and the links are hidden', async () => {
    getGitHistory.mockResolvedValue({ commits: [c(1)], hasMore: false });
    await render(ctx({ onOpenGit: undefined }));
    expect(container.querySelector<HTMLButtonElement>('.argus-inspector-commit')!.disabled).toBe(true);
    expect(container.querySelector('.argus-inspector-links')).toBeNull();
  });

  it('picks up a commit the session’s git signals missed (tip check)', async () => {
    vi.useFakeTimers();
    try {
      getGitHistory.mockResolvedValue({ commits: [c(1)], hasMore: false });
      await render(ctx());
      expect(container.querySelectorAll('.argus-inspector-commit')).toHaveLength(1);
      // Same tip: the check is one cheap request and nothing reloads.
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HISTORY_POLL_MS); });
      expect(getGitHistory).toHaveBeenLastCalledWith('s1', { limit: 1, ref: undefined });
      expect(getGitHistory).toHaveBeenCalledTimes(2);
      // A new commit on top: the check sees it and the card reloads.
      getGitHistory.mockResolvedValue({ commits: [c(3), c(1)], hasMore: false });
      await act(async () => { await vi.advanceTimersByTimeAsync(GIT_HISTORY_POLL_MS); });
      expect(getGitHistory).toHaveBeenLastCalledWith('s1', { limit: HISTORY_CARD_COMMITS, ref: undefined });
      expect(container.querySelectorAll('.argus-inspector-commit')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says when there is no repository or no commit yet', async () => {
    getGitHistory.mockResolvedValue({ commits: null, hasMore: false });
    await render(ctx());
    expect(container.textContent).toContain('Not a git repository.');
    act(() => root.unmount());
    act(() => { root = createRoot(container); });
    getGitHistory.mockResolvedValue({ commits: [], hasMore: false });
    await render(ctx());
    expect(container.textContent).toContain('No commits yet.');
  });
});
