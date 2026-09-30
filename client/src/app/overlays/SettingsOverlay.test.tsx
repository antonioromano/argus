import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

function render(config: AppConfig, initialTab?: string) {
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
function footerText(): string {
  return container.querySelector('.eyebrow[style*="flex"]')?.textContent ?? '';
}
function resetButton(): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button'))
    .find((b) => b.textContent?.startsWith('Reset all'));
  if (!btn) throw new Error('Reset all button not rendered');
  return btn as HTMLButtonElement;
}

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
    expect(activeNavLabel()).toBe('Theme & motion');
    expect(paneTitle()).toBe('Theme & motion');
    // One pane heading, not a pane heading plus a tab-name echo.
    expect(container.querySelectorAll('main h2').length).toBe(1);
  });

  it('honours a legacy tab id as a deep link', () => {
    render({ ...DEFAULT_CONFIG }, 'worktrees');
    expect(paneTitle()).toBe('Isolation');
  });

  it('switches pane on click', () => {
    render({ ...DEFAULT_CONFIG });
    const runtime = navItems().find((b) => b.textContent?.includes('Runtime'));
    act(() => { runtime?.click(); });
    expect(paneTitle()).toBe('Runtime');
  });
});

describe('sidebar filter', () => {
  it('narrows the list to matching panes', () => {
    render({ ...DEFAULT_CONFIG });
    type('tmux');
    expect(navLabels()).toEqual(['Runtime']);
  });

  it('jumps to the first match when the open pane is filtered out', () => {
    render({ ...DEFAULT_CONFIG });
    expect(paneTitle()).toBe('Theme & motion');
    type('quit');
    expect(paneTitle()).toBe('Confirmations');
  });

  it('leaves the open pane alone when it still matches', () => {
    render({ ...DEFAULT_CONFIG });
    type('waiting');
    expect(paneTitle()).toBe('Theme & motion');
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
    expect(paneTitle()).toBe('Theme & motion');
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
    expect(dotted).toEqual(['Typography', 'Toolbar']);
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
    const text = container.querySelector('main')?.textContent ?? '';
    expect(text).toContain('Closing a shell');
    expect(text).toContain('Exit all sessions on Quit');
    expect(text).toContain('Confirm before exiting');
  });

  it('hides the quit confirmation while Quit only detaches', () => {
    render({ ...DEFAULT_CONFIG, exitSessionsOnQuit: false }, 'confirmations');
    const text = container.querySelector('main')?.textContent ?? '';
    expect(text).toContain('Exit all sessions on Quit');
    expect(text).not.toContain('Confirm before exiting');
  });

  it('no longer offers a row for the non-configurable window controls', () => {
    render({ ...DEFAULT_CONFIG }, 'shell-header');
    expect(container.querySelector('main')?.textContent).not.toContain('Not configurable');
  });
});
