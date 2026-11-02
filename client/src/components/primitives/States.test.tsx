import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorState, StaleNotice } from './States.js';
import { ApiError } from '../../services/api.js';
import { registerErrorActionHost } from '../../errors/errorActions.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('ErrorState / StaleNotice', () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  const text = () => container.textContent ?? '';
  const buttons = () => [...container.querySelectorAll('button')];
  const button = (label: RegExp) => buttons().find((b) => label.test(b.textContent ?? ''));

  it('defaults its title to "Something went wrong", not "Process exited"', () => {
    act(() => { root.render(<ErrorState />); });
    expect(text()).toMatch(/Something went wrong/);
    expect(text()).not.toMatch(/Process exited/);
  });

  it('GH_NOT_INSTALLED renders a Copy “brew install gh” button that writes the clipboard', async () => {
    act(() => { root.render(<ErrorState error={new ApiError(503, 'gh missing', { code: 'GH_NOT_INSTALLED' })} />); });
    const copy = button(/brew install gh/);
    expect(copy).toBeTruthy();
    await act(async () => { copy!.click(); });
    expect(writeText).toHaveBeenCalledWith('brew install gh');
  });

  it('shows the cause, keeps raw detail behind a collapsed Details disclosure', () => {
    act(() => { root.render(<ErrorState error={new ApiError(503, 'x', { code: 'GIT_NOT_INSTALLED', detail: 'spawn git ENOENT' })} />); });
    expect(text()).toMatch(/Install it, then retry/);
    const details = container.querySelector('details');
    expect(details).toBeTruthy();
    expect(details!.open).toBe(false);
    expect(details!.querySelector('summary')?.textContent).toBe('Details');
    expect(details!.textContent).toMatch(/spawn git ENOENT/);
  });

  it('Retry shows only with onRetry and calls it', () => {
    const err = new ApiError(503, 'x', { code: 'GH_TIMEOUT' });
    act(() => { root.render(<ErrorState error={err} />); });
    expect(button(/Retry/)).toBeUndefined();
    const onRetry = vi.fn();
    act(() => { root.render(<ErrorState error={err} onRetry={onRetry} />); });
    act(() => { button(/Retry/)!.click(); });
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('a host-owned action appears once the host registers', () => {
    const err = new ApiError(503, 'x', { code: 'AGENT_UNKNOWN', params: { agent: 'nope' } });
    act(() => { root.render(<ErrorState error={err} />); });
    expect(button(/Open Settings/)).toBeUndefined();
    const openSettings = vi.fn();
    let off: () => void = () => {};
    act(() => { off = registerErrorActionHost({ 'open-settings': openSettings }); });
    act(() => { button(/Open Settings → Agents/)!.click(); });
    expect(openSettings).toHaveBeenCalledWith({ kind: 'open-settings', pane: 'agents' });
    act(() => off());
  });

  it('an explicit title wins over the described one', () => {
    act(() => { root.render(<ErrorState title="Diff failed" error={new ApiError(503, 'x', { code: 'GIT_NOT_INSTALLED' })} />); });
    expect(text()).toMatch(/Diff failed/);
    expect(text()).toMatch(/Install it, then retry/);
  });

  it('legacy callers: a bare detail string stays visible (not collapsed)', () => {
    act(() => { root.render(<ErrorState title="Cannot spawn" detail="Folder does not exist: /x" />); });
    expect(text()).toMatch(/Folder does not exist/);
    expect(container.querySelector('details')).toBeNull();
  });

  it('StaleNotice is one fixed-height line with a Retry link', () => {
    const onRetry = vi.fn();
    act(() => { root.render(<StaleNotice error={new ApiError(504, 'x', { code: 'GH_TIMEOUT' })} onRetry={onRetry} />); });
    const notice = container.querySelector('.argus-stale-notice') as HTMLElement;
    expect(notice).toBeTruthy();
    expect(notice.getAttribute('role')).toBe('status');
    expect(text()).toMatch(/last/i);
    act(() => { button(/Retry/)!.click(); });
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('StaleNotice without onRetry renders no button', () => {
    act(() => { root.render(<StaleNotice />); });
    expect(buttons()).toHaveLength(0);
    expect(text()).toMatch(/last/i);
  });
});
