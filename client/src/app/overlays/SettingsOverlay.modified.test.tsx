import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { SettingsOverlay } from './SettingsOverlay.js';

// Modified view (plan 007 U5) and per-pane reset (U6): both are reversible, so
// they write at once and offer Undo from a snapshot — no confirm.

const undo = vi.hoisted(() => ({ offers: [] as { message: string; undo: () => unknown; durationMs?: number }[] }));
vi.mock('../../utils/undoable.js', () => ({
  UNDO_WINDOW_LONG_MS: 10_000,
  offerUndo: (o: { message: string; undo: () => unknown; durationMs?: number }) => { undo.offers.push(o); return { dismiss() {} }; },
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;
const noop = () => {};
const asyncNoop = async () => {};

function render(config: AppConfig, onSave: (p: Partial<AppConfig>) => Promise<AppConfig>, initialTab?: string) {
  act(() => {
    root.render(
      <SettingsOverlay
        config={config}
        sessions={[]}
        onClose={noop}
        onSave={onSave}
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

const rows = () => Array.from(container.querySelectorAll<HTMLElement>('[data-modified-row]'));
const button = (scope: ParentNode, text: string) => {
  const b = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no "${text}" button`);
  return b;
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  undo.offers.length = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Modified view', () => {
  const changed: AppConfig = { ...DEFAULT_CONFIG, uiFontSize: 18, showClock: true };

  it('lists exactly the changed settings with current → default', () => {
    render(changed, async () => changed, 'modified');
    expect(rows().map((r) => r.dataset.modifiedRow)).toEqual(['uiFontSize', 'showClock']);
    expect(rows()[0].textContent).toContain('X-Large → Medium');
    expect(rows()[1].textContent).toContain('On → Off');
    expect(rows()[0].textContent).toContain('Theme & layout › Font sizes');
  });

  it('is reachable from the sidebar and the footer count', () => {
    render(changed, async () => changed);
    const entry = Array.from(container.querySelectorAll<HTMLButtonElement>('.settings-nav-item'))
      .find((b) => b.textContent?.startsWith('Modified'));
    expect(entry?.textContent).toBe('Modified2');
    act(() => { button(container, '2 SETTINGS CHANGED FROM DEFAULTS').click(); });
    expect(container.querySelector('main h2')?.textContent).toBe('Modified');
  });

  it('resets one row with only its key, from a fresh default, and offers Undo', async () => {
    const onSave = vi.fn(async (p: Partial<AppConfig>) => ({ ...changed, ...p }));
    render(changed, onSave, 'modified');
    act(() => { button(rows()[0], 'Reset').click(); });
    await flush();
    expect(onSave).toHaveBeenCalledWith({ uiFontSize: DEFAULT_CONFIG.uiFontSize });
    expect(undo.offers[0].message).toBe('Reset Interface');
    await act(async () => { await undo.offers[0].undo(); });
    expect(onSave).toHaveBeenLastCalledWith({ uiFontSize: 18 });
  });

  it('resets a single shortcut without touching the other bindings', async () => {
    const config = { ...DEFAULT_CONFIG, keyboardShortcuts: { 'open-diff': 'mod+shift+y', 'open-files': 'mod+shift+u' } };
    const onSave = vi.fn(async () => config);
    render(config, onSave, 'modified');
    const row = rows().find((r) => r.dataset.modifiedRow === 'shortcut:open-diff')!;
    act(() => { button(row, 'Reset').click(); });
    await flush();
    expect(onSave).toHaveBeenCalledWith({ keyboardShortcuts: { 'open-files': 'mod+shift+u' } });
  });

  it('does not list custom agents', () => {
    const config = { ...DEFAULT_CONFIG, customAgents: [{ id: 'aider', name: 'Aider', command: 'aider', builtin: false }] };
    render(config, async () => config, 'modified');
    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain('Everything is at its default');
  });

  it('Go to opens the owning pane with the row targeted', async () => {
    render(changed, async () => changed, 'modified');
    act(() => { button(rows()[1], 'Go to').click(); });
    expect(container.querySelector('main h2')?.textContent).toBe('Theme & layout');
    expect(container.querySelector('[data-setting-id="showClock"]')?.className).toContain('is-target');
  });
});

describe('Reset pane', () => {
  it('is disabled on a pane at its defaults', () => {
    render(DEFAULT_CONFIG, async () => DEFAULT_CONFIG, 'theme');
    expect(button(container, 'Reset pane').disabled).toBe(true);
  });

  it('writes only that pane’s modified keys and offers Undo', async () => {
    const config = { ...DEFAULT_CONFIG, uiFontSize: 18, showClock: true, notifyOnDone: true };
    const onSave = vi.fn(async (p: Partial<AppConfig>) => ({ ...config, ...p }));
    render(config, onSave, 'theme');
    act(() => { button(container, 'Reset pane').click(); });
    await flush();
    expect(onSave).toHaveBeenCalledWith({ uiFontSize: 14, showClock: false });
    expect(undo.offers[0].message).toBe('Reset Theme & layout');
    await act(async () => { await undo.offers[0].undo(); });
    expect(onSave).toHaveBeenLastCalledWith({ uiFontSize: 18, showClock: true });
  });

  it('on Agents touches the three preferences, never the agents or their flags', async () => {
    const config: AppConfig = {
      ...DEFAULT_CONFIG,
      defaultAgent: 'codex',
      claudeRenderer: 'classic',
      defaultSessionView: 'chat',
      customAgents: [{ id: 'aider', name: 'Aider', command: 'aider', builtin: false }],
      agentFlags: { claude: [{ id: 'f', value: '--verbose', enabled: true }] },
    };
    const onSave = vi.fn(async () => config);
    render(config, onSave, 'agents');
    act(() => { button(container, 'Reset pane').click(); });
    await flush();
    expect(onSave).toHaveBeenCalledWith({ defaultAgent: 'claude', claudeRenderer: 'fullscreen', defaultSessionView: 'terminal' });
  });

  it('Reset all writes at once with no sheet, and Undo (10 s) restores shortcuts deep-equal', async () => {
    const keyboardShortcuts = { 'open-diff': 'mod+y', 'toggle-sidebar': 'mod+shift+b' };
    const config: AppConfig = { ...DEFAULT_CONFIG, uiFontSize: 18, keyboardShortcuts };
    const onSave = vi.fn(async (p: Partial<AppConfig>) => ({ ...config, ...p }));
    render(config, onSave);
    act(() => { button(container, 'Reset all').click(); });
    await flush();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ uiFontSize: 14, keyboardShortcuts: {} });
    expect(undo.offers[0]).toMatchObject({ message: 'Reset all settings', durationMs: 10_000 });
    await act(async () => { await undo.offers[0].undo(); });
    const restored = onSave.mock.lastCall![0];
    expect(restored.keyboardShortcuts).toEqual(keyboardShortcuts);
    expect(restored.uiFontSize).toBe(18);
  });

  it('replaces the old Reset typography and Reset all shortcuts buttons', () => {
    render({ ...DEFAULT_CONFIG, uiFontSize: 18 }, async () => DEFAULT_CONFIG, 'theme');
    expect(container.textContent).not.toContain('Reset typography');
    // initialTab is read on mount only.
    act(() => root.unmount());
    root = createRoot(container);
    render({ ...DEFAULT_CONFIG, keyboardShortcuts: { 'open-diff': 'mod+y' } }, async () => DEFAULT_CONFIG, 'keyboard');
    expect(container.textContent).not.toContain('Reset all shortcuts');
    expect(button(container, 'Reset pane').disabled).toBe(false);
  });
});
