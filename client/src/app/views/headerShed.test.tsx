import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type SessionInfo } from '@argus/shared';
import type { Socket } from 'socket.io-client';
import { Mosaic } from './Mosaic.js';
import { Focus } from './Focus.js';
import { usageMeterView, type UsageMeterState } from '../../utils/usageFormat.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// Only the headers are under test; the terminals and the Focus side panels
// drag in xterm / socket plumbing.
vi.mock('../ui/TerminalShell.js', () => ({ TerminalShell: () => null }));
vi.mock('../../hooks/useCompanionTerminal.js', () => ({ useCompanionTerminal: () => ({ terminalAlive: true }) }));
vi.mock('../panels/ActivityPanel.js', () => ({ ActivityPanel: () => null }));
vi.mock('../panels/PrDiffView.js', () => ({ PrDiffView: () => null }));
vi.mock('../ui/chat/ChatView.js', () => ({ ChatView: () => null }));

// ── Fake layout ──────────────────────────────────────────────────────────────
// jsdom has no layout, so the info region gets one: it is `width` px wide, each
// piece in it takes 7px per character + 12px + an 8px gap, and the name takes
// whatever is left (it truncates when that is less than its text).
let width = 1000;
const PX_PER_CHAR = 7;
const isRegion = (el: Element) => el.getAttribute('data-testid') === 'tile-info' || el.getAttribute('data-testid') === 'focus-info';
const isName = (el: Element) => el.getAttribute('aria-label')?.startsWith('Copy path') ?? false;
const pieceWidth = (el: Element) => (el.textContent ?? '').length * PX_PER_CHAR + 12 + 8;
const fixedWidth = (region: Element) =>
  [...region.children].filter((c) => !isName(c)).reduce((sum, c) => sum + pieceWidth(c), 0);
const nameWidth = (name: Element) => Math.max(0, width - fixedWidth(name.parentElement!));

const observers = new Set<() => void>();
class FakeResizeObserver {
  private cb: () => void;
  constructor(cb: () => void) { this.cb = cb; }
  observe() { observers.add(this.cb); }
  disconnect() { observers.delete(this.cb); }
  unobserve() {}
}
function resizeTo(w: number) {
  width = w;
  act(() => { for (const cb of observers) cb(); });
}

// Both live on Element.prototype in jsdom; the fakes shadow them on
// HTMLElement.prototype and are deleted afterwards.
type Patched = { clientWidth?: number; scrollWidth?: number };

let container: HTMLDivElement;
let root: Root;
const noop = () => {};
const socket = {} as unknown as Socket<any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  width = 1000;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (isRegion(this)) return width;
      if (isName(this)) return nameWidth(this);
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (isRegion(this)) return fixedWidth(this);
      if (isName(this)) return (this.textContent ?? '').length * PX_PER_CHAR;
      return 0;
    },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (HTMLElement.prototype as Patched).clientWidth;
  delete (HTMLElement.prototype as Patched).scrollWidth;
  vi.unstubAllGlobals();
  observers.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

// ── Fixtures ─────────────────────────────────────────────────────────────────
const NOW = Date.now();
const usageMeter: UsageMeterState = {
  ...usageMeterView(DEFAULT_CONFIG)!,
  plans: { claude: { observedAt: NOW, primary: { usedPct: 52, resetsAt: NOW + 4 * 24 * 3600_000, windowMinutes: 10080 } } },
};

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's1',
    name: 'f10-argus-header-overflow',
    folderPath: '/repo',
    status: 'waiting',
    createdAt: new Date().toISOString(),
    agentType: 'claude',
    flags: [],
    worktreeBranch: 'argus/f10-argus-header-overflow',
    pr: { number: 74, state: 'open', url: 'https://github.com/o/r/pull/74', ci: 'success', branch: 'f10' },
    usage: {
      inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 2, updatedAt: 0,
      contextPct: 9, contextTokens: 18_000, contextWindow: 200_000,
    },
    ...over,
  };
}

function renderMosaic(s: SessionInfo) {
  act(() => {
    root.render(
      <Mosaic
        sessions={[s]}
        onReorder={noop}
        filter=""
        socket={socket}
        theme="dark"
        toggleMinimize={noop}
        restoreFromFilter={noop}
        restoreAll={noop}
        isMinimized={() => false}
        isForeign={() => false}
        foreignLabel={() => ''}
        onFocusForeign={noop}
        onOpenSession={noop}
        onTearOff={noop}
        onCreate={noop}
        onKill={noop}
        onRestart={noop}
        onDumpDiagnostics={noop}
        showDiagnostics={false}
        onClone={noop}
        quickAction="clone"
        usageMeter={usageMeter}
      />,
    );
  });
}

function renderFocus(s: SessionInfo) {
  act(() => {
    root.render(
      <Focus
        sessions={[s]}
        active={s}
        socket={socket}
        theme="dark"
        sidePanel={null}
        usageMeter={usageMeter}
        onSelect={noop}
        onReorder={noop}
        onBack={noop}
        onToggleDiff={noop}
        onToggleExplorer={noop}
        onToggleTerminal={noop}
        onExpandDiff={noop}
        onOpenFileInEditor={noop}
        onRestore={noop}
        onClone={noop}
        onKill={noop}
        onRestart={noop}
        onDumpDiagnostics={noop}
        showDiagnostics={false}
      />,
    );
  });
}

// What a header shows, highest shed priority first (the order things go).
function shown(region: Element) {
  return {
    reset: (region.textContent ?? '').includes('↻'),
    plan: !!region.querySelector('[data-part="plan"]'),
    ctx: !!region.querySelector('[data-part="ctx"]'),
    pills: !!region.querySelector('[data-testid="pr-chip"]'),
    status: (region.textContent ?? '').includes('WAITING'),
  };
}
const ORDER = ['reset', 'plan', 'ctx', 'pills', 'status'] as const;

/** Narrows step by step and checks each piece goes only after the ones before it. */
function expectShedOrder(regionId: string) {
  const region = () => container.querySelector(`[data-testid="${regionId}"]`)!;
  expect(Object.values(shown(region())).every(Boolean)).toBe(true);
  const goneAt: Partial<Record<(typeof ORDER)[number], number>> = {};
  for (let w = 1000; w >= 40; w -= 10) {
    resizeTo(w);
    const s = shown(region());
    for (const k of ORDER) if (!s[k] && goneAt[k] === undefined) goneAt[k] = w;
    // Anything still shown implies everything later in the order is too.
    ORDER.forEach((k, i) => { if (s[k]) for (const later of ORDER.slice(i + 1)) expect(s[later]).toBe(true); });
  }
  for (const k of ORDER) expect(goneAt[k]).toBeDefined();
  for (let i = 1; i < ORDER.length; i++) expect(goneAt[ORDER[i - 1]]!).toBeGreaterThan(goneAt[ORDER[i]]!);
  return region;
}

describe('Mosaic tile header (F12)', () => {
  const ACTIONS = ['Clone', 'Minimize to chip row', 'Expand to focus view', 'Close shell', 'More actions'];

  it('sheds reset age, plan, ctx, pills, then the status label as the tile narrows', () => {
    renderMosaic(session());
    const region = expectShedOrder('tile-info');
    expect(region().getAttribute('data-shed')).toBe('5');
    // The status dot outlives its label.
    expect(region().querySelector('.argus-dot')).not.toBeNull();
  });

  it('keeps every action rendered, outside the clipping info region, at any width', () => {
    renderMosaic(session());
    for (const w of [1000, 400, 200, 40]) {
      resizeTo(w);
      const actions = container.querySelector('.argus-tile-actions')!;
      expect(actions.closest('[data-testid="tile-info"]')).toBeNull();
      const labels = [...actions.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? '');
      for (const a of ACTIONS) expect(labels.some((l) => l.startsWith(a))).toBe(true);
    }
  });

  it('grows back when the tile widens', () => {
    renderMosaic(session());
    resizeTo(60);
    expect(container.querySelector('[data-testid="tile-info"]')!.getAttribute('data-shed')).toBe('5');
    resizeTo(1000);
    expect(container.querySelector('[data-testid="tile-info"]')!.getAttribute('data-shed')).toBe('0');
    expect(Object.values(shown(container.querySelector('[data-testid="tile-info"]')!)).every(Boolean)).toBe(true);
  });

  it('gets shed info back when the content shrinks, at the same width', () => {
    renderMosaic(session());
    const region = () => container.querySelector('[data-testid="tile-info"]')!;
    // Narrow enough that the pills go, but no further.
    let w = 1000;
    while (shown(region()).pills && w > 40) resizeTo(w -= 10);
    expect(shown(region()).pills).toBe(false);
    expect(shown(region()).status).toBe(true);
    renderMosaic(session({ pr: undefined, worktreeBranch: undefined }));
    expect(Number(region().getAttribute('data-shed'))).toBeLessThan(4);
  });

  it('lists what was shed in the name tooltip', () => {
    renderMosaic(session());
    resizeTo(60);
    const name = container.querySelector('.argus-tile-name')!;
    vi.useFakeTimers();
    try {
      act(() => { name.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
      act(() => { vi.advanceTimersByTime(1000); });
    } finally {
      vi.useRealTimers();
    }
    const tip = document.querySelector('[data-testid="shed-tooltip"]');
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toContain('WAITING');
    expect(tip!.textContent).toContain('#74');
    expect(tip!.textContent).toContain('argus/f10-argus-header-overflow');
    expect(tip!.textContent).toContain('52%');
  });
});

describe('Focus header (F12)', () => {
  const ACTIONS = ['Diff', 'Files', 'Shell', 'Exit focus', 'Start a new shell from the same folder', 'Restart shell', 'Close shell'];

  it('sheds in the same order and never moves an action into the clipping region', () => {
    renderFocus(session());
    expectShedOrder('focus-info');
    const actions = container.querySelector('[data-testid="focus-actions"]')!;
    expect(actions.closest('[data-testid="focus-info"]')).toBeNull();
    const labels = [...actions.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    for (const a of ACTIONS) expect(labels).toContain(a);
  });
});
