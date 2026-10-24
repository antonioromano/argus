import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type GitSummary, type SessionInfo } from '@argus/shared';
import { SessionInspector } from './SessionInspector.js';
import { INSPECTOR_SECTIONS } from './sections.js';
import { clampInspectorWidth } from './inspectorWidth.js';
import type { InspectorContext } from './types.js';
import { usageMeterView } from '../../utils/usageFormat.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const getGitSummary = vi.fn();
vi.mock('../../services/api.js', () => ({
  api: { getGitSummary: (id: string) => getGitSummary(id) },
}));
const openExternal = vi.fn();
vi.mock('../../utils/openExternal.js', () => ({
  openExternal: (url: string) => openExternal(url),
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

  it('shows the PR with state, branch and checks, and opens it on GitHub', async () => {
    await render({ session: session({ pr: { number: 42, state: 'open', url: 'https://github.com/o/r/pull/42', ci: 'success', branch: 'feat/x' } }) });
    const gh = sectionEl('github');
    expect(gh.textContent).toContain('o/r#42');
    expect(gh.textContent).toContain('Open');
    expect(gh.textContent).toContain('checks passing');
    act(() => gh.querySelector<HTMLButtonElement>('.argus-inspector-pr')!.click());
    expect(openExternal).toHaveBeenCalledWith('https://github.com/o/r/pull/42');
  });

  it('says when there is no PR, or when PR status is off', async () => {
    await render();
    expect(sectionEl('github').textContent).toContain('No pull request');
    await render({ ctx: ctx({ prStatusEnabled: false }) });
    expect(sectionEl('github').textContent).toContain('Pull request status is off');
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
