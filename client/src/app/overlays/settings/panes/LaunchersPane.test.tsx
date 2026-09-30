import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG } from '@argus/shared';
import { LaunchersPane } from './LaunchersPane.js';

const toasts = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('../../../../components/primitives/index.js', async (orig) => ({
  ...(await orig<typeof import('../../../../components/primitives/index.js')>()),
  pushToast: toasts.push,
}));

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const L = { id: 'jarvar-refresh', label: 'JarvAR refresh', request: { agent: 'claude', folder: '/Users/me/development/jarvar', flags: ['--model=opus'], prompt: 'refresh dashboard' }, agentCommand: 'claude', folderConfigAtSave: [], createdAt: '2026-09-30T10:00:00.000Z' };
let container: HTMLDivElement; let root: Root;
let bridge: { list: ReturnType<typeof vi.fn>; rename: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
beforeEach(() => {
  toasts.push.mockClear();
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

  it('M4: links use the scheme main exposes on the bridge', async () => {
    (window as unknown as { electronLaunch: Record<string, unknown> }).electronLaunch.scheme = 'argus-dev';
    await render();
    expect(container.textContent).toContain('argus-dev://run/jarvar-refresh');
  });

  it('M4: links fall back to argus:// when the bridge exposes no scheme', async () => {
    await render();
    expect(container.textContent).toContain('argus://run/jarvar-refresh');
    expect(container.textContent).not.toContain('argus-dev://');
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
    await act(async () => { (container.querySelector('[data-testid="launcher-delete"]') as HTMLElement).click(); });
    expect(bridge.remove).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Delete JarvAR refresh?');
    await act(async () => { (container.querySelector('[data-testid="launcher-delete-confirm"]') as HTMLElement).click(); await Promise.resolve(); });
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

describe('LaunchersPane fixes', () => {
  const setInput = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('roots textarea re-syncs when config changes while unfocused', async () => {
    const onSave = vi.fn(async (p: Partial<typeof DEFAULT_CONFIG>) => ({ ...DEFAULT_CONFIG, ...p }));
    await render(onSave);
    await act(async () => { root.render(<LaunchersPane config={{ ...DEFAULT_CONFIG, launchFolderRoots: ['~/a', '~/b'] }} onSave={onSave} />); await Promise.resolve(); });
    expect((container.querySelector('[data-testid="launch-roots"]') as HTMLTextAreaElement).value).toBe('~/a\n~/b');
  });

  it('blur with unchanged roots does not save', async () => {
    const { onSave } = await render();
    const ta = container.querySelector('[data-testid="launch-roots"]') as HTMLTextAreaElement;
    await act(async () => { ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('list rejection renders an error row', async () => {
    bridge.list.mockRejectedValueOnce(new Error('boom'));
    await render();
    const row = container.querySelector('[data-testid="launchers-error"]');
    expect(row?.textContent).toContain('boom');
  });

  it('remove rejection pushes a danger toast', async () => {
    await render();
    bridge.remove.mockRejectedValueOnce(new Error('nope'));
    await act(async () => { (container.querySelector('[data-testid="launcher-delete"]') as HTMLElement).click(); });
    await act(async () => { (container.querySelector('[data-testid="launcher-delete-confirm"]') as HTMLElement).click(); await Promise.resolve(); });
    expect(toasts.push).toHaveBeenCalledWith('nope', 'danger');
  });

  it('cancel on delete confirm does not remove', async () => {
    await render();
    await act(async () => { (container.querySelector('[data-testid="launcher-delete"]') as HTMLElement).click(); });
    await act(async () => { (container.querySelector('[data-testid="launcher-delete-cancel"]') as HTMLElement).click(); });
    expect(bridge.remove).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="launcher-delete-confirm"]')).toBeNull();
  });

  it('rename Save is disabled for a blank label', async () => {
    await render();
    await act(async () => { (container.querySelector('[data-testid="launcher-rename"]') as HTMLElement).click(); });
    await act(async () => { setInput(container.querySelector('[data-testid="launcher-rename-input"]') as HTMLInputElement, '   '); });
    const save = container.querySelector('[data-testid="launcher-rename-save"]') as HTMLElement;
    expect(save.querySelector('button')!.disabled).toBe(true);
    await act(async () => { save.click(); await Promise.resolve(); });
    expect(bridge.rename).not.toHaveBeenCalled();
  });
});
