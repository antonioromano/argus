import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInfo, WorktreeFinishInfo, WorktreeFinishResponse, WorktreeFinishStep } from '@argus/shared';
import { DEFAULT_CONFIG } from '@argus/shared';
import { FinishWorktreeHost, FinishWorktreeSheet } from './FinishWorktreeSheet.js';
import { defaultCommitMessage } from './finishWorktree.js';
import { StaleChip } from '../ui/StaleChip.js';

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  diff: vi.fn(),
  finish: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../services/api.js', () => ({
  api: {
    getWorktreeFinishInfo: mocks.info,
    getSessionDiff: mocks.diff,
    finishWorktree: mocks.finish,
    removeFinishedWorktree: mocks.remove,
  },
}));

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

// SplitDiff measures its grid; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const SESSION: SessionInfo = {
  id: 's1', name: 'x', folderPath: '/wt', status: 'idle', createdAt: '', agentType: 'claude', flags: [],
  worktreePath: '/wt', worktreeBranch: 'argus/feat/add-login',
};
const INFO: WorktreeFinishInfo = {
  worktreePath: '/wt', branch: 'argus/feat/add-login', upstream: null, defaultBranch: 'main', dirty: true,
  pr: null, ghAvailable: true, compareUrl: 'https://github.com/o/r/compare/main...x?expand=1',
  merged: false, removable: false, removeBlockedReason: 'not merged',
};
const DIFF = {
  unstaged: '', staged: '', untracked: [], untrackedDiff: '',
  branch: 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
};

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.info.mockReset().mockResolvedValue(INFO);
  mocks.diff.mockReset().mockResolvedValue(DIFF);
  mocks.finish.mockReset().mockImplementation(async (_id: string, steps: WorktreeFinishStep[]): Promise<WorktreeFinishResponse> => (
    { ok: true, results: [{ step: steps[0], status: 'ok' }] }
  ));
  mocks.remove.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
async function render(onClose = vi.fn(), onRemoved = vi.fn()) {
  await act(async () => { root.render(<FinishWorktreeSheet session={SESSION} onClose={onClose} onRemoved={onRemoved} />); });
  await flush();
  return { onClose, onRemoved };
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const box = (step: string) => q(`finish-step-${step}`)!.querySelector('[role="checkbox"]') as HTMLElement;
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

describe('defaultCommitMessage', () => {
  it('turns a conventional branch into a conventional message', () => {
    expect(defaultCommitMessage('argus/feat/add-login')).toBe('feat: add login');
    expect(defaultCommitMessage('fix/null_ref')).toBe('fix: null ref');
    expect(defaultCommitMessage('spike-cache')).toBe('spike cache');
  });
});

describe('FinishWorktreeSheet', () => {
  it('shows branch, upstream, changed files and a prefilled message', async () => {
    await render();
    expect(q('finish-sheet')).toBeTruthy();
    expect(document.body.textContent).toContain('argus/feat/add-login');
    expect(q('finish-upstream')!.textContent).toMatch(/no upstream/);
    expect([...document.querySelectorAll('[data-testid="finish-file"]')].map((b) => b.textContent)).toEqual(['src/a.ts']);
    expect((q('finish-message') as HTMLTextAreaElement).value).toBe('feat: add login');
    // Dirty ⇒ commit preselected, along with push and PR.
    expect(['commit', 'push', 'pr'].map((s) => box(s).getAttribute('aria-checked'))).toEqual(['true', 'true', 'true']);
  });

  it('runs only the selected steps, in order, one request each', async () => {
    await render();
    act(() => { box('push').click(); });
    await act(async () => { button('Run Commit → Open PR')!.click(); });
    await flush();
    expect(mocks.finish.mock.calls.map((c) => c[1])).toEqual([['commit'], ['pr']]);
    expect(mocks.finish.mock.calls[0][2]).toBe('feat: add login');
    expect(q('finish-step-commit')!.dataset.status).toBe('ok');
    expect(q('finish-step-pr')!.dataset.status).toBe('ok');
  });

  it('stops at the first failure, shows its error and skips the rest', async () => {
    mocks.finish.mockImplementation(async (_id: string, steps: WorktreeFinishStep[]) => (
      steps[0] === 'push'
        ? { ok: false, results: [{ step: 'push', status: 'failed', detail: 'rejected: non-fast-forward' }] }
        : { ok: true, results: [{ step: steps[0], status: 'ok' }] }
    ));
    await render();
    await act(async () => { button('Run Commit → Push → Open PR')!.click(); });
    await flush();
    expect(mocks.finish.mock.calls.map((c) => c[1])).toEqual([['commit'], ['push']]);
    expect(q('finish-step-push')!.dataset.status).toBe('failed');
    expect(q('finish-step-push')!.textContent).toContain('rejected: non-fast-forward');
    expect(q('finish-step-pr')!.dataset.status).toBe('skipped');
  });

  it('a clean tree cannot commit, and an empty message blocks a commit run', async () => {
    mocks.info.mockResolvedValue({ ...INFO, dirty: false });
    await render();
    expect(box('commit').getAttribute('aria-checked')).toBe('false');
    expect(box('commit').getAttribute('tabindex')).toBe('-1');
    act(() => root.unmount());
    root = createRoot(container);

    mocks.info.mockResolvedValue(INFO);
    await render();
    const ta = q('finish-message') as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => { setter.call(ta, '   '); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(button('Run Commit')!.disabled).toBe(true);
  });

  it('an already-open PR disables the Open PR step', async () => {
    mocks.info.mockResolvedValue({ ...INFO, pr: { number: 4, state: 'open', url: 'https://github.com/o/r/pull/4', ci: 'none', branch: 'x' } });
    await render();
    expect(box('pr').getAttribute('aria-checked')).toBe('false');
    expect(q('finish-step-pr')!.textContent).toContain('PR #4 is already open');
  });

  it('offers Remove only when removable, behind an in-page confirm', async () => {
    await render();
    expect(button('Remove worktree')).toBeUndefined();
    act(() => root.unmount());
    root = createRoot(container);

    mocks.info.mockResolvedValue({ ...INFO, dirty: false, merged: true, removable: true, removeBlockedReason: undefined });
    const { onClose, onRemoved } = await render();
    act(() => { button('Remove worktree…')!.click(); });
    expect(q('finish-remove-confirm')).toBeTruthy();
    expect(mocks.remove).not.toHaveBeenCalled();
    await act(async () => { [...q('finish-remove-confirm')!.querySelectorAll('button')].find((b) => b.textContent === 'Remove worktree')!.click(); });
    await flush();
    expect(mocks.remove).toHaveBeenCalledWith('s1');
    expect(onRemoved).toHaveBeenCalledWith(SESSION);
    expect(onClose).toHaveBeenCalled();
  });

  it('explains why a merged but dirty worktree cannot be removed', async () => {
    mocks.info.mockResolvedValue({ ...INFO, merged: true, removable: false, removeBlockedReason: 'The worktree has uncommitted changes.' });
    await render();
    expect(button('Remove worktree')).toBeUndefined();
    expect(q('finish-remove-blocked')!.textContent).toContain('uncommitted changes');
  });
});

describe('beta flag off', () => {
  it('the host renders nothing and makes no request', async () => {
    await act(async () => {
      root.render(<FinishWorktreeHost config={DEFAULT_CONFIG} session={SESSION} onClose={vi.fn()} />);
    });
    await flush();
    expect(container.innerHTML).toBe('');
    expect(document.querySelector('[data-testid="finish-sheet"]')).toBeNull();
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.diff).not.toHaveBeenCalled();
  });

  it('the host renders the sheet once the flag is on, and never for a non-worktree shell', async () => {
    await act(async () => {
      root.render(<FinishWorktreeHost config={{ ...DEFAULT_CONFIG, betaWorktreeLifecycle: true }} session={{ ...SESSION, worktreePath: undefined }} onClose={vi.fn()} />);
    });
    await flush();
    expect(mocks.info).not.toHaveBeenCalled();
    await act(async () => {
      root.render(<FinishWorktreeHost config={{ ...DEFAULT_CONFIG, betaWorktreeLifecycle: true }} session={SESSION} onClose={vi.fn()} />);
    });
    await flush();
    expect(document.querySelector('[data-testid="finish-sheet"]')).toBeTruthy();
  });

  it('no stale marker without staleDays (the server sends none while the flag is off)', () => {
    act(() => { root.render(<StaleChip />); });
    expect(container.innerHTML).toBe('');
    act(() => { root.render(<StaleChip staleDays={21} />); });
    expect(container.querySelector('[data-testid="stale-chip"]')?.textContent).toBe('stale');
  });
});
