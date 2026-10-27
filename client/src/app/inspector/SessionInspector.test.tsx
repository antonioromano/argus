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
const setSessionPrReady = vi.fn();
vi.mock('../../services/api.js', () => ({
  api: {
    getGitSummary: (id: string) => getGitSummary(id),
    getSessionPrs: (id: string) => getSessionPrs(id),
    setSessionPrReady: (id: string, url: string, ready: boolean) => setSessionPrReady(id, url, ready),
  },
}));
const pushToast = vi.fn();
vi.mock('../../components/primitives/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/primitives/index.js')>()),
  pushToast: (message: string, tone?: string) => pushToast(message, tone),
}));
const openExternal = vi.fn();
vi.mock('../../utils/openExternal.js', () => ({
  openExternal: (url: string) => openExternal(url),
}));
// The History card has its own tests (HistorySection.test.tsx); here it just stays quiet.
vi.mock('../../hooks/useGitHistory.js', () => ({
  useGitHistory: () => ({ commits: [], hasMore: false, loading: false, error: null, loadMore: () => {}, refresh: () => {} }),
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

  it('renders the usage, git, history and GitHub sections in order, open by default', async () => {
    await render();
    const ids = Array.from(container.querySelectorAll('[data-section]')).map((el) => el.getAttribute('data-section'));
    expect(ids).toEqual(['usage', 'git', 'history', 'github']);
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
    const part = (m: Element, cls: string) => m.querySelector(`.argus-inspector-meter-${cls}`)?.textContent;
    // Label and percentage share the left of the head line; the secondary figure sits apart.
    expect(part(meters[0], 'label')).toBe('Context');
    expect(part(meters[0], 'pct')).toBe('47%');
    expect(part(meters[0], 'aside')).toBe('94k / 200k');
    expect(meters[0].getAttribute('data-level')).toBe('ok');
    expect(part(meters[1], 'label')).toBe('Session');
    expect(part(meters[1], 'pct')).toBe('96%');
    expect(part(meters[1], 'aside')).toMatch(/^Resets in (1 hr|59 min)$/);
    expect(meters[1].getAttribute('data-level')).toBe('high');
    // The bar is the meter for assistive tech, named after the limit.
    expect(meters[1].querySelector('[role="meter"]')!.getAttribute('aria-label')).toBe('Session');
    // No model name in the card.
    expect(sectionEl('usage').textContent).not.toContain('Opus');
  });

  it('labels a weekly window and shows a reset that has passed as "Just reset" at 0%', async () => {
    await render({
      ctx: ctx({ usageMeter: { ...usageMeterView(DEFAULT_CONFIG)!, plans: { claude: { observedAt: NOW, primary: { usedPct: 80, resetsAt: NOW - 1, windowMinutes: 300 }, secondary: { usedPct: 12, resetsAt: NOW + 3 * 86_400_000, windowMinutes: 10_080 } } } } }),
    });
    const meters = sectionEl('usage').querySelectorAll('.argus-inspector-meter');
    expect(meters).toHaveLength(2);
    expect(meters[0].querySelector('.argus-inspector-meter-pct')!.textContent).toBe('0%');
    expect(meters[0].querySelector('.argus-inspector-meter-aside')!.textContent).toBe('Just reset');
    expect(meters[1].querySelector('.argus-inspector-meter-label')!.textContent).toBe('Weekly');
    expect(meters[1].querySelector('.argus-inspector-meter-aside')!.textContent).toMatch(/^Resets \S+ /);
  });

  it('glances at the context and the fullest plan window when collapsed', async () => {
    await render({
      collapsed: ['usage'],
      session: session({ usage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, updatedAt: 0, contextPct: 47 } }),
    });
    const glance = sectionEl('usage').querySelector('.argus-inspector-section-summary')!;
    expect(glance.textContent).toBe('ctx 47%·5h 96%');
    expect(glance.querySelector('[data-level="ok"]')!.textContent).toBe('47%');
    expect(glance.querySelector('[data-level="high"]')!.textContent).toBe('96%');
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
    expect(rows.map((r) => r.querySelector('.argus-inspector-pr-title')!.textContent)).toEqual(['Speed up', 'Add login', 'Fix lib', 'gone #3']);
    // Compact `repo #n`; the full owner/repo#n is its tooltip.
    const refEl = rows[0].querySelector('.argus-inspector-pr-ref')!;
    expect(refEl.textContent).toBe('r #9');
    expect(refEl.getAttribute('title')).toBe('o/r#9');
    // The state is the glyph (named for screen readers), not a label.
    expect(rows.map((r) => r.querySelector('.argus-inspector-pr-glyph')!.getAttribute('aria-label'))).toEqual(['Open pull request', 'Open pull request', 'Merged pull request', 'Pull request']);
    expect(rows[0].textContent).not.toContain('Open');
    // Under the `…`: the checks dot. Under the state glyph: review / conflict icons.
    expect(rows[0].querySelector('.argus-inspector-pr-ci-cell .argus-inspector-ci-btn')!.getAttribute('data-ci')).toBe('failure');
    const flags = Array.from(rows[0].querySelectorAll<HTMLElement>(':scope > .argus-inspector-pr-flag'));
    expect(flags.map((f) => f.getAttribute('aria-label'))).toEqual(['changes requested', 'merge conflicts']);
    expect(flags[1].getAttribute('data-row')).toBe('3');
    // The tooltip says what the icon means.
    vi.useFakeTimers();
    act(() => { flags[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); flags[0].dispatchEvent(new MouseEvent('mouseenter')); });
    act(() => { vi.advanceTimersByTime(1000); });
    vi.useRealTimers();
    expect(Array.from(document.body.querySelectorAll('[role="tooltip"]')).map((t) => t.textContent)).toContain('changes requested');
    expect(rows[0].textContent).not.toContain('this branch');
    expect(rows[1].textContent).toContain('this branch');
    expect(rows[1].querySelector('.argus-inspector-pr-review')!.getAttribute('aria-label')).toBe('approved');
    // Merged: its checks and review no longer matter.
    expect(rows[2].querySelector('.argus-inspector-ci-btn')).toBeNull();
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

  it('C4: the row menu opens on GitHub, copies the link, views changes; only an open PR converts to draft', async () => {
    const open = { url: FOLDER.url, pr: FOLDER, folderBranch: true, linked: true };
    const merged = { url: OTHER.url, pr: OTHER, folderBranch: false, linked: true };
    getSessionPrs.mockResolvedValue({ enabled: true, prs: [open, merged] });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onOpenPrDiff = vi.fn();
    await render({ ctx: ctx({ onOpenPrDiff }) });
    const rows = () => Array.from(sectionEl('github').querySelectorAll<HTMLElement>('.argus-inspector-prrow'));
    const openMenu = (row: HTMLElement) => act(() => row.querySelector<HTMLButtonElement>('.argus-inspector-pr-more button')!.click());
    const items = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]'));
    const pick = (label: string) => act(() => items().find((b) => b.textContent === label)!.click());

    expect(rows()[0].querySelector('.argus-inspector-pr-more button')!.getAttribute('aria-label')).toBe('More actions for o/r#42');
    // Self-explanatory glyph: no hover tooltip.
    vi.useFakeTimers();
    act(() => { rows()[0].querySelector('.argus-inspector-pr-more button')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(1000); });
    vi.useRealTimers();
    expect(Array.from(document.body.querySelectorAll('[role="tooltip"]')).map((t) => t.textContent)).not.toContain('More actions for o/r#42');
    openMenu(rows()[0]);
    expect(items().map((b) => b.textContent)).toEqual(['Open on GitHub', 'Copy link', 'View changes', 'Convert to draft']);
    pick('Open on GitHub');
    expect(openExternal).toHaveBeenCalledWith(FOLDER.url);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();

    openMenu(rows()[0]);
    await act(async () => { items().find((b) => b.textContent === 'Copy link')!.click(); });
    expect(writeText).toHaveBeenCalledWith(FOLDER.url);
    expect(pushToast).toHaveBeenCalledWith('Link copied', 'ok');

    openMenu(rows()[0]);
    pick('View changes');
    expect(onOpenPrDiff).toHaveBeenCalledWith('s1', open);

    // Merged: nothing to convert. Right-click opens the menu too.
    act(() => { rows()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
    expect(items().map((b) => b.textContent)).toEqual(['Open on GitHub', 'Copy link', 'View changes']);
    const menuEl = () => document.body.querySelector<HTMLElement>('[role="menu"]');
    const placed = menuEl()!.style.cssText;
    // A right-click inside the (portalled) menu doesn't re-open or move it.
    act(() => { items()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 })); });
    expect(menuEl()!.style.cssText).toBe(placed);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });

    // The `…` button toggles its menu: a second press closes it.
    const more = rows()[0].querySelector<HTMLButtonElement>('.argus-inspector-pr-more button')!;
    act(() => more.click());
    expect(menuEl()).not.toBeNull();
    act(() => {
      more.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      more.click();
    });
    expect(menuEl()).toBeNull();
  });

  it('C4: a right-click inside the CI popover does not open the row menu', async () => {
    const checks = { counts: { passed: 0, failed: 1, pending: 0, skipped: 0 }, failed: [{ name: 'lint' }] };
    getSessionPrs.mockResolvedValue({ enabled: true, prs: [{ url: FAILING.url, pr: { ...FAILING, checks }, folderBranch: false, linked: true }] });
    await render();
    act(() => sectionEl('github').querySelector<HTMLButtonElement>('.argus-inspector-ci-btn')!.click());
    const pop = document.body.querySelector<HTMLElement>('.argus-ci-popover')!;
    act(() => { pop.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 })); });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('C4: Convert to draft asks first, then runs the C3 route with ready: false', async () => {
    getSessionPrs.mockResolvedValue({ enabled: true, prs: [{ url: FOLDER.url, pr: FOLDER, folderBranch: true, linked: true }] });
    setSessionPrReady.mockResolvedValue({ pr: { ...FOLDER, state: 'draft' } });
    await render();
    const openMenu = () => act(() => sectionEl('github').querySelector<HTMLButtonElement>('.argus-inspector-pr-more button')!.click());
    const pickDraft = () => act(() => Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent === 'Convert to draft')!.click());
    const sheetButton = (label: string) => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label)!;

    openMenu();
    pickDraft();
    expect(document.body.textContent).toContain('Convert to draft?');
    act(() => sheetButton('Cancel').click());
    expect(document.body.textContent).not.toContain('Convert to draft?');
    expect(setSessionPrReady).not.toHaveBeenCalled();

    openMenu();
    pickDraft();
    await act(async () => { sheetButton('Convert to draft').click(); });
    expect(setSessionPrReady).toHaveBeenCalledWith('s1', FOLDER.url, false);
    expect(pushToast).toHaveBeenCalledWith('o/r#42 is a draft again', 'ok');
  });

  it('C3: a draft PR offers Mark ready; it runs gh through the server, toasts, and reads the list again', async () => {
    const DRAFT = { ...FOLDER, state: 'draft' as const };
    getSessionPrs.mockResolvedValue({ enabled: true, prs: [
      { url: DRAFT.url, pr: DRAFT, folderBranch: true, linked: true },
      { url: FAILING.url, pr: FAILING, folderBranch: false, linked: true },
    ] });
    let finish!: (v: unknown) => void;
    setSessionPrReady.mockReturnValue(new Promise((r) => { finish = r; }));
    await render();
    const rows = Array.from(sectionEl('github').querySelectorAll<HTMLElement>('.argus-inspector-prrow'));
    expect(rows[1].querySelector('.argus-inspector-pr-ready')).toBeNull();
    const button = rows[0].querySelector<HTMLButtonElement>('.argus-inspector-pr-ready')!;
    expect(button.textContent).toBe('Mark ready');
    expect(getSessionPrs).toHaveBeenCalledTimes(1);

    act(() => button.click());
    expect(setSessionPrReady).toHaveBeenCalledWith('s1', DRAFT.url, true);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Marking ready…');
    await act(async () => { finish({ pr: FOLDER }); });
    expect(pushToast).toHaveBeenCalledWith('o/r#42 is ready for review', 'ok');
    expect(getSessionPrs).toHaveBeenCalledTimes(2);
  });

  it('C3: a gh error from Mark ready is shown as a toast', async () => {
    const DRAFT = { ...FOLDER, state: 'draft' as const };
    getSessionPrs.mockResolvedValue({ enabled: true, prs: [{ url: DRAFT.url, pr: DRAFT, folderBranch: true, linked: true }] });
    setSessionPrReady.mockRejectedValue(new Error('GraphQL: Resource not accessible by integration'));
    await render();
    await act(async () => { sectionEl('github').querySelector<HTMLButtonElement>('.argus-inspector-pr-ready')!.click(); });
    expect(pushToast).toHaveBeenCalledWith('Couldn’t mark o/r#42 ready: GraphQL: Resource not accessible by integration', 'danger');
    expect(sectionEl('github').querySelector<HTMLButtonElement>('.argus-inspector-pr-ready')!.disabled).toBe(false);
  });

  it('C2: the diff button shows the changed lines formatted and opens the PR changes', async () => {
    const big = { url: FOLDER.url, pr: { ...FOLDER, additions: 4024, deletions: 1310 }, folderBranch: true, linked: false };
    const unknown = { url: OTHER.url, pr: OTHER, folderBranch: false, linked: true };
    getSessionPrs.mockResolvedValue({ enabled: true, prs: [big, unknown] });
    const onOpenPrDiff = vi.fn();
    await render({ ctx: ctx({ onOpenPrDiff }) });
    const buttons = Array.from(sectionEl('github').querySelectorAll<HTMLButtonElement>('.argus-inspector-pr-files'));
    expect(buttons[0].textContent).toBe('+4,024−1,310');
    expect(buttons[0].getAttribute('title')).toBe('Open changes');
    expect(buttons[0].querySelector('.argus-inspector-pr-add')!.textContent).toBe('+4,024');
    expect(buttons[0].querySelector('.argus-inspector-pr-del')!.textContent).toBe('−1,310');
    // gh didn't report the counts: the button still opens the changes.
    expect(buttons[1].textContent).toBe('Changed files');
    act(() => buttons[0].click());
    expect(onOpenPrDiff).toHaveBeenCalledWith('s1', big);
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
