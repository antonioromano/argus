import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type GitSummary, type SessionInfo } from '@argus/shared';
import { SessionInspector } from './SessionInspector.js';
import { INSPECTOR_SECTIONS } from './sections.js';
import { clampInspectorWidth } from './inspectorWidth.js';
import type { InspectorContext } from './types.js';
import { usageMeterView } from '../../utils/usageFormat.js';
import { resetSessionPrsCache } from '../../hooks/useSessionPrs.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getGitSummary = vi.fn();
const getSessionPrs = vi.fn();
vi.mock('../../services/api.js', () => ({
  api: { getGitSummary: (id: string) => getGitSummary(id), getSessionPrs: (id: string) => getSessionPrs(id) },
}));
const openExternal = vi.fn();
vi.mock('../../utils/openExternal.js', () => ({
  openExternal: (url: string) => openExternal(url),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  getSessionPrs.mockResolvedValue({ enabled: true, prs: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  vi.clearAllMocks();
  resetSessionPrsCache();
});

const NOW = Date.now();

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's1',
    name: 'billing spike',
    folderPath: '/repo',
    status: 'idle',
    createdAt: new Date().toISOString(),
    agentType: 'claude',
    flags: [],
    ...over,
  };
}

const summary: GitSummary = {
  root: '/repo',
  branch: 'feat/login',
  detached: false,
  ahead: 2,
  behind: 0,
  changes: 2,
  upstream: 'origin/feat/login',
  files: [
    { path: 'src/app/a.ts', status: 'M', staged: false },
    { path: 'notes.txt', status: '?', staged: false },
  ],
};

function ctx(over: Partial<InspectorContext> = {}): InspectorContext {
  return {
    usageMeter: { ...usageMeterView(DEFAULT_CONFIG)!, plans: { claude: { observedAt: NOW, primary: { usedPct: 96, resetsAt: NOW + 3_600_000, windowMinutes: 300 } } } },
    prStatusEnabled: true,
    onOpenDiff: vi.fn(),
    ...over,
  };
}

async function render(props: Partial<Parameters<typeof SessionInspector>[0]> = {}) {
  await act(async () => {
    root.render(
      <SessionInspector
        session={session()}
        placement="column"
        collapsed={[]}
        onToggleSection={vi.fn()}
        side="left"
        onSwitchSide={vi.fn()}
        ctx={ctx()}
        {...props}
      />,
    );
  });
}

const sectionEl = (id: string) => container.querySelector<HTMLElement>(`[data-section="${id}"]`)!;
const head = (id: string) => sectionEl(id).querySelector<HTMLButtonElement>('.argus-inspector-section-head')!;

describe('SessionInspector', () => {
  beforeEach(() => { getGitSummary.mockResolvedValue({ summary }); });

  it('shows the placeholder when no shell is selected', async () => {
    await render({ session: null, placeholder: 'Select a tile to inspect it.' });
    expect(container.textContent).toContain('Select a tile to inspect it.');
    expect(container.querySelector('[data-section]')).toBeNull();
  });

  it('titles itself with the shell it describes, not with its own name', async () => {
    await render();
    const head = container.querySelector('.argus-inspector-head')!;
    expect(head.textContent).toContain('billing spike');
    expect(head.textContent).not.toMatch(/inspector/i);
    // No selection: the body's placeholder says so, the header stays quiet.
    await render({ session: null });
    expect(container.querySelector('.argus-inspector-head')!.textContent).toBe('');
  });

  it('renders the usage, git and GitHub sections in order, open by default', async () => {
    await render();
    const ids = Array.from(container.querySelectorAll('[data-section]')).map((el) => el.getAttribute('data-section'));
    expect(ids).toEqual(['usage', 'git', 'github']);
    for (const id of ids) expect(head(id!).getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps every section id a valid persisted slug', () => {
    for (const s of INSPECTOR_SECTIONS) expect(s.id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
  });

  it('collapses the listed sections, shows their glance, and reports toggles by id', async () => {
    const onToggleSection = vi.fn();
    await render({
      collapsed: ['github', 'git'],
      onToggleSection,
      session: session({ worktreeBranch: 'argus/feat-x', hasGitChanges: true, pr: { number: 42, state: 'open', url: 'https://github.com/o/r/pull/42', ci: 'failure', branch: 'feat-x' } }),
    });
    expect(head('git').getAttribute('aria-expanded')).toBe('false');
    expect(sectionEl('git').querySelector('.argus-inspector-section-body')).toBeNull();
    expect(sectionEl('git').textContent).toContain('feat-x');
    expect(sectionEl('github').textContent).toContain('#42');
    // A closed Git section fetches nothing.
    expect(getGitSummary).not.toHaveBeenCalled();
    act(() => head('git').click());
    expect(onToggleSection).toHaveBeenCalledWith('git');
  });

  it('moves to the other side from its header button', async () => {
    const onSwitchSide = vi.fn();
    await render({ onSwitchSide, side: 'left' });
    const btn = container.querySelector<HTMLButtonElement>('[aria-label="Move inspector to the right"]')!;
    act(() => btn.click());
    expect(onSwitchSide).toHaveBeenCalledTimes(1);
    await render({ side: 'right' });
    expect(container.querySelector('[aria-label="Move inspector to the left"]')).not.toBeNull();
  });
});

describe('Usage section', () => {
  beforeEach(() => { getGitSummary.mockResolvedValue({ summary }); });

  it('shows the context window and the plan window together, warning past the thresholds', async () => {
    await render({
      session: session({ usage: { inputTokens: 10, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 30, updatedAt: 0, contextPct: 47, contextTokens: 94_000, contextWindow: 200_000, model: 'claude-opus-5-5' } }),
    });
    const meters = sectionEl('usage').querySelectorAll('.argus-inspector-meter');
    expect(meters).toHaveLength(2);
    expect(meters[0].textContent).toContain('Context');
    expect(meters[0].textContent).toContain('47% used');
    expect(meters[0].textContent).toContain('94k / 200k');
    expect(meters[0].getAttribute('data-level')).toBe('ok');
    expect(meters[1].textContent).toContain('5-hour');
    expect(meters[1].getAttribute('data-level')).toBe('high');
    // Short model name; the full id stays on hover.
    expect(sectionEl('usage').textContent).toContain('Opus 5.5');
    expect(sectionEl('usage').querySelector('[title="claude-opus-5-5"]')).not.toBeNull();
  });

  it('expands a details breakdown of the context window and the session tokens', async () => {
    await render({
      session: session({ usage: { inputTokens: 100, outputTokens: 300, cacheCreationTokens: 0, cacheReadTokens: 600, totalTokens: 1000, updatedAt: 0, contextPct: 25, contextTokens: 50_000, contextWindow: 200_000 } }),
    });
    const usage = sectionEl('usage');
    expect(usage.querySelector('.argus-inspector-share')).toBeNull();
    const toggle = usage.querySelector<HTMLButtonElement>('.argus-inspector-disclosure-head')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => toggle.click());
    const row = (key: string) => usage.querySelector(`.argus-inspector-share[data-share="${key}"]`)!.textContent;
    expect(row('used')).toContain('25.0%');
    expect(row('free')).toContain('150k');
    expect(row('free')).toContain('75.0%');
    expect(row('cache-read')).toContain('60.0%');
    expect(row('cache-write')).toContain('—');
  });

  it('says so for an agent without a meter, and while the meter is off', async () => {
    await render({ session: session({ agentType: 'gemini' }) });
    expect(sectionEl('usage').textContent).toContain('doesn’t report usage');
    await render({ ctx: ctx({ usageMeter: null }) });
    expect(sectionEl('usage').textContent).toContain('usage meter is off');
  });
});

describe('Git section', () => {
  it('lists branch, upstream with ahead/behind, and the changed files; a file opens the Diff on it', async () => {
    getGitSummary.mockResolvedValue({ summary });
    const onOpenDiff = vi.fn();
    await render({ ctx: ctx({ onOpenDiff }) });
    const git = sectionEl('git');
    expect(getGitSummary).toHaveBeenCalledWith('s1');
    expect(git.textContent).toContain('feat/login');
    expect(git.textContent).toContain('origin/feat/login');
    expect(git.textContent).toContain('↑2');
    expect(git.textContent).not.toContain('↓');
    const files = Array.from(git.querySelectorAll<HTMLButtonElement>('.argus-inspector-file'));
    expect(files.map((f) => f.textContent)).toEqual(['Ma.tssrc/app/', '?notes.txt']);
    act(() => files[0].click());
    expect(onOpenDiff).toHaveBeenCalledWith('s1', 'src/app/a.ts');
  });

  it('reports a folder outside git', async () => {
    getGitSummary.mockResolvedValue({ summary: null });
    await render();
    expect(sectionEl('git').textContent).toContain('Not a git repository');
  });
});

describe('GitHub section', () => {
  beforeEach(() => { getGitSummary.mockResolvedValue({ summary }); });

  const FOLDER = { number: 42, state: 'open' as const, url: 'https://github.com/o/r/pull/42', ci: 'success' as const, branch: 'feat/x', title: 'Add login', review: 'approved' as const, mergeable: 'mergeable' as const };
  const OTHER = { number: 7, state: 'merged' as const, url: 'https://github.com/o/lib/pull/7', ci: 'none' as const, branch: 'fix/y', title: 'Fix lib' };
  const FAILING = { number: 9, state: 'open' as const, url: 'https://github.com/o/r/pull/9', ci: 'failure' as const, branch: 'feat/z', title: 'Speed up', review: 'changes_requested' as const, mergeable: 'conflicting' as const };

  it('lists every PR newest first with state, checks, review and conflicts; marks the folder branch PR', async () => {
    getSessionPrs.mockResolvedValue({ enabled: true, prs: [
      { url: FAILING.url, pr: FAILING, folderBranch: false, linked: true },
      { url: FOLDER.url, pr: FOLDER, folderBranch: true, linked: true },
      { url: OTHER.url, pr: OTHER, folderBranch: false, linked: true },
      { url: 'https://github.com/o/gone/pull/3', pr: null, folderBranch: false, linked: true },
    ] });
    await render({ session: session({ pr: FOLDER }) });
    const gh = sectionEl('github');
    expect(getSessionPrs).toHaveBeenCalledWith('s1');
    const rows = Array.from(gh.querySelectorAll<HTMLElement>('.argus-inspector-prrow'));
    expect(rows.map((r) => r.querySelector('.argus-inspector-pr-title')!.textContent)).toEqual(['Speed up', 'Add login', 'Fix lib', 'o/gone#3']);
    expect(rows[0].textContent).toContain('o/r#9');
    expect(rows[0].textContent).toContain('checks failing');
    expect(rows[0].textContent).toContain('changes requested');
    expect(rows[0].textContent).toContain('conflicts');
    expect(rows[0].textContent).not.toContain('this branch');
    expect(rows[1].textContent).toContain('this branch');
    expect(rows[1].textContent).toContain('approved');
    expect(rows[2].textContent).toContain('Merged');
    expect(rows[2].textContent).not.toContain('checks');
    expect(rows[3].textContent).toContain('status unavailable');
    // Tone: failing checks / conflicts amber, mergeable green, merged purple, unknown untinted.
    expect(rows.map((r) => r.getAttribute('data-tone'))).toEqual(['blocked', 'ready', 'merged', null]);
    act(() => rows[2].querySelector<HTMLButtonElement>('.argus-inspector-pr')!.click());
    expect(openExternal).toHaveBeenCalledWith(OTHER.url);
    // No "Files" action until B4 wires onOpenPrDiff.
    expect(gh.querySelector('.argus-inspector-pr-files')).toBeNull();
  });

  it('offers "Files" on every row once onOpenPrDiff is wired', async () => {
    const entry = { url: FOLDER.url, pr: FOLDER, folderBranch: true, linked: false };
    getSessionPrs.mockResolvedValue({ enabled: true, prs: [entry] });
    const onOpenPrDiff = vi.fn();
    await render({ ctx: ctx({ onOpenPrDiff }) });
    act(() => sectionEl('github').querySelector<HTMLButtonElement>('.argus-inspector-pr-files')!.click());
    expect(onOpenPrDiff).toHaveBeenCalledWith('s1', entry);
  });

  it('C1: the checks dot sums the checks up and opens the CI monitoring popover', async () => {
    const checks = { counts: { passed: 5, failed: 2, pending: 1, skipped: 1 }, failed: [{ name: 'CI / test', url: 'https://github.com/o/r/actions/runs/1' }, { name: 'legacy' }] };
    getSessionPrs.mockResolvedValue({ enabled: true, prs: [
      { url: FAILING.url, pr: { ...FAILING, checks }, folderBranch: false, linked: true },
      { url: FOLDER.url, pr: { ...FOLDER, checks: { counts: { passed: 3, failed: 0, pending: 0, skipped: 0 }, failed: [] } }, folderBranch: true, linked: true },
      { url: OTHER.url, pr: OTHER, folderBranch: false, linked: true },
    ] });
    await render();
    const rows = Array.from(sectionEl('github').querySelectorAll<HTMLElement>('.argus-inspector-prrow'));
    const dot = rows[0].querySelector<HTMLButtonElement>('.argus-inspector-ci-btn')!;
    expect(dot.getAttribute('title')).toBe('CI: 2 failed, 1 pending');
    expect(rows[1].querySelector('.argus-inspector-ci-btn')!.getAttribute('title')).toBe('CI: all checks passed');
    // Merged: its checks no longer matter, no dot.
    expect(rows[2].querySelector('.argus-inspector-ci-btn')).toBeNull();

    act(() => dot.click());
    const pop = document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="CI monitoring"]')!;
    expect(dot.getAttribute('aria-expanded')).toBe('true');
    const counts = Array.from(pop.querySelectorAll('.argus-ci-popover-counts li')).map((li) => li.textContent);
    expect(counts).toEqual(['Failed2', 'Pending1', 'Passed5', 'Skipped1']);
    const failed = Array.from(pop.querySelectorAll('.argus-ci-popover-failed li'));
    expect(failed.map((li) => li.textContent)).toEqual(['CI / test', 'legacy']);
    act(() => failed[0].querySelector<HTMLButtonElement>('button')!.click());
    expect(openExternal).toHaveBeenCalledWith('https://github.com/o/r/actions/runs/1');
    expect(failed[1].querySelector('button')).toBeNull();

    act(() => pop.querySelector<HTMLButtonElement>('.argus-ci-popover-open')!.click());
    expect(openExternal).toHaveBeenLastCalledWith(`${FAILING.url}/checks`);
    expect(document.body.querySelector('.argus-ci-popover')).toBeNull();

    // Escape closes it too.
    act(() => dot.click());
    expect(document.body.querySelector('.argus-ci-popover')).not.toBeNull();
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.body.querySelector('.argus-ci-popover')).toBeNull();
  });

  it('shows the header chip PR while the list loads', async () => {
    getSessionPrs.mockReturnValue(new Promise(() => {}));
    await render({ session: session({ pr: FOLDER }) });
    expect(sectionEl('github').textContent).toContain('Add login');
  });

  it('says when there is no PR, or when PR status is off (no fetch then)', async () => {
    await render();
    expect(sectionEl('github').textContent).toContain('No pull request');
    getSessionPrs.mockClear();
    await render({ ctx: ctx({ prStatusEnabled: false }) });
    expect(sectionEl('github').textContent).toContain('Pull request status is off');
    expect(getSessionPrs).not.toHaveBeenCalled();
  });

  it('a closed card fetches nothing; its glance counts the last list with the worst checks', async () => {
    await render({ collapsed: ['github'], session: session({ pr: FOLDER }) });
    expect(getSessionPrs).not.toHaveBeenCalled();
    expect(sectionEl('github').textContent).toContain('#42');

    getSessionPrs.mockResolvedValue({ enabled: true, prs: [
      { url: FAILING.url, pr: FAILING, folderBranch: false, linked: true },
      { url: FOLDER.url, pr: FOLDER, folderBranch: true, linked: true },
      { url: OTHER.url, pr: OTHER, folderBranch: false, linked: true },
    ] });
    await render({ collapsed: [], session: session({ pr: FOLDER }) });
    await render({ collapsed: ['github'], session: session({ pr: FOLDER }) });
    const glance = sectionEl('github').querySelector<HTMLElement>('.argus-inspector-section-summary [title]')!;
    expect(glance.textContent).toContain('3 PRs');
    expect(glance.querySelector('.argus-pr-ci')!.getAttribute('data-ci')).toBe('failure');
    expect(glance.getAttribute('title')).toBe('2 open, 1 merged · checks failing');

    // The chip's live answer wins over the remembered reading while collapsed.
    await render({ collapsed: ['github'], session: session({ pr: { ...FAILING, ci: 'success' } }) });
    const live = sectionEl('github').querySelector<HTMLElement>('.argus-inspector-section-summary [title]')!;
    expect(live.textContent).toContain('3 PRs');
    expect(live.querySelector('.argus-pr-ci')!.getAttribute('data-ci')).toBe('success');
    expect(getSessionPrs).toHaveBeenCalledTimes(1);
  });
});

describe('clampInspectorWidth', () => {
  it('clamps to the shared bounds and falls back to the default', () => {
    expect(clampInspectorWidth(10)).toBe(220);
    expect(clampInspectorWidth(9999)).toBe(560);
    expect(clampInspectorWidth(undefined)).toBe(300);
    expect(clampInspectorWidth(Number.NaN)).toBe(300);
  });
});
