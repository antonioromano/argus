import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG } from '@argus/shared';
import { LaunchersPane } from './LaunchersPane.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const L = { id: 'jarvar-refresh', label: 'JarvAR refresh', request: { agent: 'claude', folder: '/Users/me/development/jarvar', flags: ['--model=opus'], prompt: 'refresh dashboard' }, agentCommand: 'claude', folderConfigAtSave: [], createdAt: '2026-09-30T10:00:00.000Z' };
let container: HTMLDivElement; let root: Root;
let bridge: { list: ReturnType<typeof vi.fn>; rename: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  bridge = { list: vi.fn(async () => [L]), rename: vi.fn(async () => ({ ok: true })), remove: vi.fn(async () => ({ ok: true })) };
  (window as unknown as { electronLaunch?: unknown }).electronLaunch = { launchers: bridge };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete (window as unknown as { electronLaunch?: unknown }).electronLaunch; });

async function render(onSave = vi.fn(async (p: Partial<typeof DEFAULT_CONFIG>) => ({ ...DEFAULT_CONFIG, ...p }))) {
  await act(async () => { root.render(<LaunchersPane config={{ ...DEFAULT_CONFIG }} onSave={onSave} />); await Promise.resolve(); });
  return { onSave };
}

describe('LaunchersPane', () => {
  it('empty state', async () => {
    bridge.list.mockResolvedValueOnce([]);
    await render();
    expect(container.textContent).toContain('No launchers');
  });

  it('row shows label, run link, agent @ folder; expand shows args and prompt', async () => {
    await render();
    expect(container.textContent).toContain('JarvAR refresh');
    expect(container.textContent).toMatch(/argus(-dev)?:\/\/run\/jarvar-refresh/);
    expect(container.textContent).toContain('claude @ jarvar');
    await act(async () => { (container.querySelector('[data-testid="launcher-expand"]') as HTMLElement).click(); });
    expect(container.textContent).toContain('--model=opus');
    expect(container.textContent).toContain('refresh dashboard');
  });

  it('rename is inline (Electron has no window.prompt) and goes over the bridge', async () => {
    await render();
    await act(async () => { (container.querySelector('[data-testid="launcher-rename"]') as HTMLElement).click(); });
    const input = container.querySelector('[data-testid="launcher-rename-input"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Refresh JarvAR');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { (container.querySelector('[data-testid="launcher-rename-save"]') as HTMLElement).click(); await Promise.resolve(); });
    expect(bridge.rename).toHaveBeenCalledWith('jarvar-refresh', 'Refresh JarvAR');
  });

  it('delete goes over the bridge and refreshes', async () => {
    await render();
    bridge.list.mockResolvedValueOnce([]);
    await act(async () => { (container.querySelector('[data-testid="launcher-delete"]') as HTMLElement).click(); await Promise.resolve(); });
    expect(bridge.remove).toHaveBeenCalledWith('jarvar-refresh');
    expect(container.textContent).toContain('No launchers');
  });

  it('roots editor saves one root per line', async () => {
    const { onSave } = await render();
    const ta = container.querySelector('[data-testid="launch-roots"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, '~/development\n~/work\n');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); // React's onBlur listens to focusout
    });
    expect(onSave).toHaveBeenCalledWith({ launchFolderRoots: ['~/development', '~/work'] });
  });
});
