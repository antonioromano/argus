import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { SettingsOverlay } from './SettingsOverlay.js';
import { PANES, GROUP_ORDER } from './settings/registry.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

const noop = () => {};
const asyncNoop = async () => {};

function render(config: AppConfig, initialTab?: string, focusSetting?: string) {
  act(() => {
    root.render(
      <SettingsOverlay
        config={config}
        sessions={[]}
        onClose={noop}
        onSave={async () => config}
        onSaveFlag={asyncNoop}
        onDeleteFlag={asyncNoop}
        ngrokStatus={null}
        ngrokLoading={false}
        ngrokError={null}
        onNgrokStart={noop}
        onNgrokStop={noop}
        initialTab={initialTab}
        focusSetting={focusSetting}
      />,
    );
  });
}

/** The sidebar's pane rows, in render order. */
function navItems(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('.settings-nav-item'));
}
function navLabels(): string[] {
  return navItems().map((b) => b.querySelector('span')?.textContent ?? '');
}
function activeNavLabel(): string | undefined {
  return navItems().find((b) => b.getAttribute('aria-selected') === 'true')
    ?.querySelector('span')?.textContent ?? undefined;
}
/** The open pane's heading. */
function paneTitle(): string | null {
  return container.querySelector('main h2')?.textContent ?? null;
}
function filterInput(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.settings-nav-search input');
  if (!input) throw new Error('filter input not rendered');
  return input;
}
/** React tracks an input's last value on the node, so assigning `.value`
 *  directly makes it treat the change as a no-op. Go through the prototype's
 *  native setter, which is what React's own test utils do. */
function type(value: string) {
  const input = filterInput();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** Control-level hits listed under their pane while the filter has a query. */
function hitLabels(): string[] {
  return Array.from(container.querySelectorAll('.settings-nav-hit .settings-nav-hit-label'))
    .map((el) => el.textContent ?? '');
}
function hit(label: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll<HTMLButtonElement>('.settings-nav-hit'))
    .find((b) => b.querySelector('.settings-nav-hit-label')?.textContent === label);
  if (!btn) throw new Error(`no hit "${label}" (have: ${hitLabels().join(', ')})`);
  return btn;
}
function row(id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-setting-id="${id}"]`);
}
/** The jump scrolls on the next frame; let it run. */
async function flushFrame() {
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}
function footerText(): string {
  return container.querySelector('.eyebrow[style*="flex"]')?.textContent ?? '';
}
function resetButton(): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button'))
    .find((b) => b.textContent?.startsWith('Reset all'));
  if (!btn) throw new Error('Reset all button not rendered');
  return btn as HTMLButtonElement;
}

let scrolled: string[];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); // the last pane shown is remembered across opens
  // jsdom has no layout, so no scrollIntoView — record which row asked for it.
  scrolled = [];
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this.getAttribute('data-setting-id') ?? '');
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

describe('settings shell', () => {
  it('lists every registered pane under its group heading', () => {
    render({ ...DEFAULT_CONFIG });
    expect(navLabels()).toEqual(PANES.map((p) => p.label));

    const groups = Array.from(container.querySelectorAll('.settings-nav-group'))
      .map((el) => el.textContent);
    expect(groups).toEqual(GROUP_ORDER);
  });

  it('opens the first pane by default, titled once', () => {
    render({ ...DEFAULT_CONFIG });
    expect(activeNavLabel()).toBe('Theme & layout');
    expect(paneTitle()).toBe('Theme & layout');
    // One pane heading, not a pane heading plus a tab-name echo.
    expect(container.querySelectorAll('main h2').length).toBe(1);
  });

  it('honours a legacy tab id as a deep link', () => {
    render({ ...DEFAULT_CONFIG }, 'worktrees');
    expect(paneTitle()).toBe('Worktrees');
  });

  it('switches pane on click', () => {
    render({ ...DEFAULT_CONFIG });
    const runtime = navItems().find((b) => b.textContent?.includes('Sessions & processes'));
    act(() => { runtime?.click(); });
    expect(paneTitle()).toBe('Sessions & processes');
  });

  it('reopens on the last pane shown', () => {
    render({ ...DEFAULT_CONFIG });
    act(() => { navItems().find((b) => b.textContent?.includes('Sessions & processes'))?.click(); });
    act(() => root.unmount());
    act(() => { root = createRoot(container); });
    render({ ...DEFAULT_CONFIG });
    expect(paneTitle()).toBe('Sessions & processes');
  });

  it('an explicit tab wins over the remembered pane', () => {
    localStorage.setItem('argus.settingsPane', 'runtime');
    render({ ...DEFAULT_CONFIG }, 'remote');
    expect(paneTitle()).toBe('Remote access');
  });

  it('a remembered pane id that no longer exists falls back to the first pane', () => {
    localStorage.setItem('argus.settingsPane', 'gone');
    render({ ...DEFAULT_CONFIG });
    expect(paneTitle()).toBe('Theme & layout');
  });
});

describe('sidebar filter', () => {
  it('narrows the list to matching panes', () => {
    render({ ...DEFAULT_CONFIG });
    type('tmux');
    expect(navLabels()).toEqual(['Sessions & processes']);
  });

  it('jumps to the first match when the open pane is filtered out', () => {
    render({ ...DEFAULT_CONFIG });
    expect(paneTitle()).toBe('Theme & layout');
    type('quit');
    expect(paneTitle()).toBe('General');
  });

  it('leaves the open pane alone when it still matches', () => {
    render({ ...DEFAULT_CONFIG });
    type('waiting');
    expect(paneTitle()).toBe('Theme & layout');
  });

  it('restores the full list when cleared', () => {
    render({ ...DEFAULT_CONFIG });
    type('ngrok');
    expect(navLabels()).toEqual(['Remote access']);
    type('');
    expect(navLabels().length).toBe(PANES.length);
  });

  it('says so when nothing matches, without emptying the content pane', () => {
    render({ ...DEFAULT_CONFIG });
    type('zzzznope');
    expect(navLabels()).toEqual([]);
    expect(container.textContent).toContain('Nothing matches');
    expect(paneTitle()).toBe('Theme & layout');
  });
});

describe('modified accounting', () => {
  it('reports all-defaults and disables Reset all', () => {
    render({ ...DEFAULT_CONFIG });
    expect(footerText()).toBe('ALL SETTINGS AT DEFAULTS');
    expect(resetButton().disabled).toBe(true);
    expect(container.querySelectorAll('.settings-nav-dot').length).toBe(0);
  });

  it('counts changed keys and marks only the owning pane', () => {
    render({ ...DEFAULT_CONFIG, uiFontSize: 18, showClock: true });
    expect(footerText()).toBe('2 SETTINGS CHANGED FROM DEFAULTS');
    expect(resetButton().disabled).toBe(false);

    const dotted = navItems()
      .filter((b) => b.querySelector('.settings-nav-dot'))
      .map((b) => b.querySelector('span')?.textContent);
    expect(dotted).toEqual(['Theme & layout']);
  });

  it('uses the singular for exactly one change', () => {
    render({ ...DEFAULT_CONFIG, codeFontSize: 17 });
    expect(footerText()).toBe('1 SETTING CHANGED FROM DEFAULTS');
  });
});

describe('pane content', () => {
  // The three confirmation prefs used to live in two different tabs; the point of
  // the pane is that all of them are on it.
  it('collects every confirmation on one pane', () => {
    render({ ...DEFAULT_CONFIG, exitSessionsOnQuit: true }, 'confirmations');
    expect(paneTitle()).toBe('General');
    const text = container.querySelector('main')?.textContent ?? '';
    expect(text).toContain('Closing a running session');
    expect(text).toContain('Stop all sessions when quitting');
    expect(text).toContain('Ask before stopping sessions');
  });

  it('General also holds sleep and the Others folder name', () => {
    render({ ...DEFAULT_CONFIG }, 'general');
    const text = container.querySelector('main')?.textContent ?? '';
    expect(text).toContain('Closing a running session');
    expect(text).toContain('Keep Mac awake while running');
    expect(text).toContain('"Others" folder name');
  });

  it('Theme & layout holds the font sizes and the status bar clock', () => {
    render({ ...DEFAULT_CONFIG }, 'typography');
    expect(paneTitle()).toBe('Theme & layout');
    const text = container.querySelector('main')?.textContent ?? '';
    expect(text).toContain('Appearance');
    expect(text).toContain('Code');
    expect(text).toContain('Interface');
    expect(text).toContain('Show clock in status bar');
  });

  it('Runtime holds the developer tools under Diagnostics', () => {
    render({ ...DEFAULT_CONFIG }, 'developer');
    expect(paneTitle()).toBe('Sessions & processes');
    const text = container.querySelector('main')?.textContent ?? '';
    expect(text).toContain('Diagnostics');
    expect(text).toContain('Enable developer tools');
  });

  it('hides the quit confirmation while Quit only detaches', () => {
    render({ ...DEFAULT_CONFIG, exitSessionsOnQuit: false }, 'general');
    const text = container.querySelector('main')?.textContent ?? '';
    expect(text).toContain('Stop all sessions when quitting');
    expect(text).not.toContain('Ask before stopping sessions');
  });

  it('no longer offers a row for the non-configurable window controls', () => {
    render({ ...DEFAULT_CONFIG }, 'shell-header');
    expect(container.querySelector('main')?.textContent).not.toContain('Not configurable');
  });
});

describe('control-level search', () => {
  it('lists matching controls under their pane', () => {
    render({ ...DEFAULT_CONFIG });
    type('seconds');
    expect(navLabels()).toEqual(['Theme & layout']);
    expect(hitLabels()).toEqual(['Show seconds']);
  });

  it('lists no hits without a query', () => {
    render({ ...DEFAULT_CONFIG });
    expect(hitLabels()).toEqual([]);
  });

  it('jumps to the pane of the top hit when the open pane is filtered out', () => {
    render({ ...DEFAULT_CONFIG }, 'remote');
    type('play a sound');
    expect(paneTitle()).toBe('Notifications');
  });

  it('opens the pane, scrolls to the row and flashes it on click', async () => {
    render({ ...DEFAULT_CONFIG, showClock: true }, 'remote');
    type('seconds');
    act(() => { hit('Show seconds').click(); });
    await flushFrame();
    expect(paneTitle()).toBe('Theme & layout');
    expect(row('clockShowSeconds')?.classList.contains('is-target')).toBe(true);
    expect(scrolled).toEqual(['clockShowSeconds']);
  });

  it('points a hidden control at the toggle that reveals it', async () => {
    render({ ...DEFAULT_CONFIG, showClock: false });
    type('seconds');
    expect(hit('Show seconds').textContent).toContain('Turn on Show clock in status bar first');
    act(() => { hit('Show seconds').click(); });
    await flushFrame();
    expect(row('clockShowSeconds')).toBeNull();
    expect(row('showClock')?.classList.contains('is-target')).toBe(true);
    expect(scrolled).toEqual(['showClock']);
  });

  it('Enter in the filter goes to the top hit', async () => {
    render({ ...DEFAULT_CONFIG });
    type('play a sound');
    act(() => {
      filterInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flushFrame();
    expect(paneTitle()).toBe('Notifications');
    expect(row('notificationSound')?.classList.contains('is-target')).toBe(true);
  });

  it('drops the highlight after the flash', async () => {
    vi.useFakeTimers();
    try {
      render({ ...DEFAULT_CONFIG }, undefined, 'notificationSound');
      act(() => { vi.advanceTimersByTime(50); });
      expect(row('notificationSound')?.classList.contains('is-target')).toBe(true);
      act(() => { vi.advanceTimersByTime(2000); });
      expect(row('notificationSound')?.classList.contains('is-target')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('focusSetting deep link', () => {
  it('opens the pane holding the setting with its row targeted', async () => {
    render({ ...DEFAULT_CONFIG }, 'remote', 'notificationSound');
    await flushFrame();
    expect(paneTitle()).toBe('Notifications');
    expect(row('notificationSound')?.classList.contains('is-target')).toBe(true);
    expect(scrolled).toEqual(['notificationSound']);
  });

  it('reaches generated settings such as a shortcut row', async () => {
    render({ ...DEFAULT_CONFIG }, undefined, 'shortcut:new-session');
    await flushFrame();
    expect(paneTitle()).toBe('Keyboard');
    expect(row('shortcut:new-session')?.classList.contains('is-target')).toBe(true);
  });

  it('falls back to initialTab for an unknown id', async () => {
    render({ ...DEFAULT_CONFIG }, 'remote', 'no-such-setting');
    await flushFrame();
    expect(paneTitle()).toBe('Remote access');
    expect(container.querySelector('.is-target')).toBeNull();
  });
});
