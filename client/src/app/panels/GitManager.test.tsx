import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GitCommitDetail, GitCommitSummary, GitRefsResponse, SessionInfo } from '@argus/shared';
import { GitManager } from './GitManager.js';
import { clearGitCommitDetailCache } from '../../hooks/useGitHistory.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getGitHistory = vi.fn();
const getGitCommitDetail = vi.fn();
const getGitRefs = vi.fn();
vi.mock('../../services/api.js', () => ({
  api: {
    getGitHistory: (...a: unknown[]) => getGitHistory(...a),
    getGitCommitDetail: (...a: unknown[]) => getGitCommitDetail(...a),
    getGitRefs: (...a: unknown[]) => getGitRefs(...a),
  },
}));

let container: HTMLDivElement;
let root: Root;
const originalIO = globalThis.IntersectionObserver;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Every observed section is "near": diff bodies mount, and the list's end is in view.
  globalThis.IntersectionObserver = class {
    private cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
    observe(target: Element) { this.cb([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
  // SplitDiff measures its rows.
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
  clearGitCommitDetailCache();
  vi.clearAllMocks();
});

const NOW = Date.now();
const session: SessionInfo = {
  id: 's1', name: 'billing', folderPath: '/repo', status: 'idle', createdAt: new Date().toISOString(), agentType: 'claude', flags: [],
};

function commit(n: number, over: Partial<GitCommitSummary> = {}): GitCommitSummary {
  const hash = String(n).repeat(40).slice(0, 40);
  return {
    hash, shortHash: hash.slice(0, 7), parents: ['f'.repeat(40)], authorName: 'Ada', authorEmail: 'ada@x',
    authorDate: NOW - n * 3_600_000, subject: `commit ${n}`, refs: [], ...over,
  };
}

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,2 @@',
  '-const a = 1;',
  '+const a = 2;',
  ' export {};',
  '',
].join('\n');

function detail(c: GitCommitSummary, over: Partial<GitCommitDetail> = {}): GitCommitDetail {
  return {
    ...c, committerName: c.authorName, committerEmail: c.authorEmail, commitDate: c.authorDate,
    message: `${c.subject}\n\nWhy it changed.`, files: [{ path: 'src/a.ts', additions: 1, deletions: 1 }], diff: DIFF, ...over,
  };
}

const refs: NonNullable<GitRefsResponse['refs']> = {
  root: '/repo',
  current: 'main',
  local: [
    { name: 'main', ref: 'refs/heads/main', shortHash: '1111111', current: true, upstream: 'origin/main', ahead: 1, behind: 0, upstreamGone: false, date: NOW, subject: 'commit 1' },
    { name: 'side', ref: 'refs/heads/side', shortHash: '3333333', current: false, upstream: null, ahead: null, behind: null, upstreamGone: false, date: NOW, subject: 'side work', worktreePath: '/wt/side' },
  ],
  remote: [
    { name: 'origin/main', ref: 'refs/remotes/origin/main', shortHash: '2222222', current: false, upstream: null, ahead: null, behind: null, upstreamGone: false, date: NOW, subject: 'commit 2' },
  ],
  worktrees: [
    { path: '/repo', branch: 'main', head: '1111111aaa', bare: false, detached: false, locked: false, prunable: false, current: true, main: true },
    { path: '/wt/side', branch: 'side', head: '3333333bbb', bare: false, detached: false, locked: true, prunable: false, current: false, main: false },
  ],
};

async function render(props: Partial<Parameters<typeof GitManager>[0]> = {}) {
  await act(async () => {
    root.render(<GitManager session={session} onClose={vi.fn()} {...props} />);
  });
}

const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); };
const rows = () => Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));
const tab = (name: string) => Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent?.startsWith(name))!;

describe('GitManager', () => {
  beforeEach(() => {
    const c1 = commit(1, { refs: [{ kind: 'branch', name: 'main', current: true }, { kind: 'tag', name: 'v1' }] });
    const c2 = commit(2);
    getGitHistory.mockResolvedValue({ commits: [c1, c2], hasMore: false });
    getGitCommitDetail.mockImplementation(async (_id: string, hash: string) => detail(hash === c1.hash ? c1 : c2));
    getGitRefs.mockResolvedValue({ refs });
  });

  it('lists the history and shows the newest commit: message, metadata and a read-only diff', async () => {
    await render();
    expect(rows().map((r) => r.querySelector('.argus-git-commit-subject')!.textContent)).toEqual(['commit 1', 'commit 2']);
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
    expect(rows()[0].textContent).toContain('main');
    expect(rows()[0].textContent).toContain('v1');
    expect(getGitCommitDetail).toHaveBeenCalledWith('s1', commit(1).hash);

    const head = container.querySelector('.argus-git-detail-head')!;
    expect(head.textContent).toContain('commit 1');
    expect(head.textContent).toContain('Why it changed.');
    expect(head.textContent).toContain(commit(1).hash);
    // The diff: file list + the changed lines, and none of the working-tree actions.
    expect(container.querySelector('.argus-rodiff-files')!.textContent).toContain('src/a.ts');
    expect(container.querySelector('.argus-rodiff-main')!.textContent).toContain('const a = 2;');
    for (const action of ['STAGE', 'ROLLBACK', 'ACCEPT', 'UNSTAGE']) {
      expect(container.textContent).not.toContain(action);
    }
  });

  it('selecting another commit loads its detail; arrows step through the list', async () => {
    await render();
    await click(rows()[1]);
    expect(rows()[1].getAttribute('aria-selected')).toBe('true');
    expect(getGitCommitDetail).toHaveBeenLastCalledWith('s1', commit(2).hash);
    const list = container.querySelector('[role="listbox"]')!;
    await act(async () => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('opens on the commit it was given, and follows a new one', async () => {
    await render({ initialCommit: commit(2).hash });
    expect(rows()[1].getAttribute('aria-selected')).toBe('true');
    await render({ initialCommit: commit(1).hash });
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('loads the next page on demand', async () => {
    getGitHistory.mockResolvedValueOnce({ commits: [commit(1), commit(2)], hasMore: true });
    getGitHistory.mockResolvedValueOnce({ commits: [commit(3)], hasMore: false });
    await render();
    const more = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Load more');
    // The stub observer reports the list end in view, which already asked for page 2.
    if (more) await click(more);
    expect(getGitHistory).toHaveBeenCalledWith('s1', { skip: 2, limit: 50, ref: undefined });
    expect(rows()).toHaveLength(3);
    expect(container.querySelector('.argus-git-list-end')!.textContent).toBe('3 commits');
  });

  it('says when a commit’s diff was too large, listing its files instead', async () => {
    getGitCommitDetail.mockImplementation(async () => detail(commit(1), {
      diff: '', truncated: true, files: [{ path: 'big.json', additions: 90000, deletions: 0 }, { path: 'img.png', additions: null, deletions: null }],
    }));
    await render();
    const notice = container.querySelector('.argus-git-notice')!;
    expect(notice.textContent).toContain('too large');
    expect(notice.textContent).toContain('big.json');
    expect(notice.textContent).toContain('binary');
  });

  it('shows branches with tracking, and a branch opens its history', async () => {
    await render();
    await click(tab('Branches'));
    expect(tab('Branches').textContent).toContain('3');
    const text = container.textContent!;
    expect(text).toContain('LOCAL · 2');
    expect(text).toContain('REMOTE · 1');
    expect(text).toContain('↑1');
    expect(text).toContain('no upstream');
    expect(text).toContain('current');
    const side = Array.from(container.querySelectorAll<HTMLElement>('.argus-git-row')).find((r) => r.textContent?.includes('side work'))!;
    await click(side);
    expect(tab('History').getAttribute('aria-selected')).toBe('true');
    expect(getGitHistory).toHaveBeenLastCalledWith('s1', { limit: 50, ref: 'refs/heads/side' });
    expect(container.querySelector('.argus-git-from')!.textContent).toContain('side');
  });

  it('lists worktrees with their state', async () => {
    await render({ initialTab: 'worktrees' });
    const r = Array.from(container.querySelectorAll<HTMLElement>('.argus-git-row'));
    expect(r).toHaveLength(2);
    expect(r[0].textContent).toContain('this session');
    expect(r[0].textContent).toContain('main');
    expect(r[1].textContent).toContain('side /wt/');
    expect(r[1].textContent).toContain('locked');
  });

  it('reports a folder outside git', async () => {
    getGitHistory.mockResolvedValue({ commits: null, hasMore: false });
    await render();
    expect(container.textContent).toContain('Not a git repository');
  });
});
