import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PendingLaunchView } from '@argus/shared';
import { PendingLaunchCard, START_DELAY_MS } from './PendingLaunchCard.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const base: PendingLaunchView = {
  id: 'id-1', source: 'new', label: 'jarvar', agent: 'claude', folder: '/Users/me/development/jarvar',
  args: ['--model=opus', 'line1\nline2'], prompt: 'line1\nline2', command: "claude --model=opus 'line1\nline2'",
  warnings: [], state: 'pending', receivedAt: 0, canSaveAsLauncher: true,
};

let container: HTMLDivElement; let root: Root;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

async function render(view: Partial<PendingLaunchView> = {}, handlers: { onApprove?: Mock; onDiscard?: Mock; index?: number } = {}) {
  const onApprove = handlers.onApprove ?? vi.fn(async () => ({ ok: true }));
  const onDiscard = handlers.onDiscard ?? vi.fn(async () => {});
  await act(async () => { root.render(<PendingLaunchCard view={{ ...base, ...view }} index={handlers.index ?? 0} onApprove={onApprove} onDiscard={onDiscard} />); });
  return { onApprove, onDiscard };
}
const q = (sel: string) => container.querySelector(sel) as HTMLElement;
const start = () => q('[data-testid="launch-start"]') as HTMLButtonElement;

describe('PendingLaunchCard', () => {
  it('lists every argument on its own row and shows the prompt with visible newlines and a count', async () => {
    await render();
    const rows = container.querySelectorAll('[data-testid="launch-arg"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe('--model=opus');
    const prompt = q('[data-testid="launch-prompt"]');
    expect(prompt.textContent).toContain('⏎');
    expect(q('[data-testid="launch-prompt-count"]').textContent).toContain('11');
  });

  it('Start is aria-disabled for the delay, then enabled; never type=submit or autofocused', async () => {
    const { onApprove } = await render();
    expect(start().getAttribute('aria-disabled')).toBe('true');
    expect(start().type).toBe('button');
    expect(document.activeElement).not.toBe(start());
    await act(async () => { start().click(); });
    expect(onApprove).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(START_DELAY_MS); });
    expect(start().getAttribute('aria-disabled')).toBe('false');
    await act(async () => { start().click(); });
    expect(onApprove).toHaveBeenCalledWith('id-1', undefined);
  });

  it('delay restarts when the card moves (index change) and on window focus', async () => {
    const h = { onApprove: vi.fn(async () => ({ ok: true })), onDiscard: vi.fn(), index: 0 };
    await render({}, h);
    await act(async () => { vi.advanceTimersByTime(START_DELAY_MS); });
    await render({}, { ...h, index: 1 });
    expect(start().getAttribute('aria-disabled')).toBe('true');
    await act(async () => { vi.advanceTimersByTime(START_DELAY_MS); });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(start().getAttribute('aria-disabled')).toBe('true');
  });

  it('Enter on the card does not approve; Esc on the card discards', async () => {
    const { onApprove, onDiscard } = await render();
    await act(async () => { vi.advanceTimersByTime(START_DELAY_MS); });
    const card = q('[data-testid="launch-card"]');
    await act(async () => { card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onApprove).not.toHaveBeenCalled();
    await act(async () => { card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onDiscard).toHaveBeenCalledWith('id-1');
  });

  it('warnings render as icon + text rows', async () => {
    await render({ warnings: [{ kind: 'folder-agent-config', detail: 'Loads when the agent starts: .claude' }] });
    const w = q('[data-testid="launch-warning"]');
    expect(w.textContent).toContain('Loads when the agent starts');
    expect(w.querySelector('svg')).not.toBeNull();
  });

  it('save-as-launcher passes id and label; disabled with helper text when not allowed', async () => {
    const { onApprove } = await render();
    await act(async () => { (q('[data-testid="launch-save-toggle"]') as HTMLInputElement).click(); });
    const id = q('[data-testid="launch-save-id"]') as HTMLInputElement;
    expect(id.value).toBe('jarvar');
    await act(async () => { vi.advanceTimersByTime(START_DELAY_MS); start().click(); });
    expect(onApprove).toHaveBeenCalledWith('id-1', { id: 'jarvar', label: 'jarvar' });

    await render({ canSaveAsLauncher: false, worktree: 'feat/x' });
    expect((q('[data-testid="launch-save-toggle"]') as HTMLInputElement).disabled).toBe(true);
    expect(container.textContent).toContain('would create the same branch every run');
  });

  it('states: starting, error with Retry, expired with Dismiss only', async () => {
    await render({ state: 'starting' });
    expect(container.textContent).toContain('Starting…');
    await render({ state: 'error', error: 'boom' });
    expect(container.textContent).toContain('boom');
    expect(container.textContent).toContain('Retry');
    await render({ state: 'expired' });
    expect(container.textContent).toContain('Expired');
    expect(q('[data-testid="launch-start"]')).toBeNull();
  });

  it('run card with launcher-changed warning: update toggle sends overwrite; new card never shows it', async () => {
    const { onApprove } = await render({
      source: 'run', launcherId: 'nightly', label: 'Nightly', canSaveAsLauncher: false,
      warnings: [{ kind: 'launcher-changed', detail: 'Launcher command changed' }],
    });
    expect(q('[data-testid="launch-save-toggle"]')).toBeNull();
    expect(container.textContent).toContain('Update launcher nightly to this command (stops asking next time)');
    await act(async () => { (q('[data-testid="launch-update-toggle"]') as HTMLInputElement).click(); });
    await act(async () => { vi.advanceTimersByTime(START_DELAY_MS); });
    await act(async () => { start().click(); });
    expect(onApprove).toHaveBeenCalledWith('id-1', { id: 'nightly', label: 'Nightly', overwrite: true });

    await render({ warnings: [{ kind: 'launcher-changed', detail: 'x' }] });
    expect(q('[data-testid="launch-update-toggle"]')).toBeNull();
  });
});
