import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ToastOptions } from '../components/primitives/Toast.js';
import { ApiError } from '../services/api.js';

type PushArgs = [message: string, tone?: string, opts?: ToastOptions];
const pushToast = vi.fn<(...a: PushArgs) => { dismiss: () => void }>(() => ({ dismiss: () => {} }));
vi.mock('../components/primitives/Toast.js', () => ({ pushToast: (...a: PushArgs) => pushToast(...a) }));

const { toastError } = await import('./toastError.js');

beforeEach(() => {
  pushToast.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
});

describe('toastError', () => {
  it('a coded error toasts its mapped copy, never the raw message, with its fix as the action', async () => {
    toastError(new ApiError(503, 'spawn gh ENOENT', { code: 'GH_NOT_INSTALLED' }), 'Couldn’t merge');
    const [message, tone, opts] = pushToast.mock.calls[0]!;
    expect(tone).toBe('danger');
    expect(message).toContain('GitHub CLI isn’t installed');
    expect(message).not.toContain('ENOENT');
    expect(opts?.action?.label).toBe('Copy “brew install gh”');
    await opts!.action!.run();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('brew install gh');
    expect(pushToast).toHaveBeenLastCalledWith('Copied “brew install gh”', 'ok');
  });

  it('an uncoded error toasts the fallback title with the server’s reason', () => {
    toastError(new ApiError(400, 'A branch named feat/x already exists'), 'Couldn’t create the worktree');
    expect(pushToast.mock.calls[0]![0]).toBe('Couldn’t create the worktree: A branch named feat/x already exists');
    expect(pushToast.mock.calls[0]![2]).toBeUndefined();
  });

  it('shortens a long reason to one line', () => {
    toastError(new Error(`line one\n${'x'.repeat(400)}`), 'Save failed');
    const message = pushToast.mock.calls[0]![0];
    expect(message.startsWith('Save failed: line one x')).toBe(true);
    expect(message.length).toBeLessThan(200);
    expect(message.endsWith('…')).toBe(true);
  });

  it('offers Retry when the caller can repeat the action and no fix applies', async () => {
    const onRetry = vi.fn();
    toastError(new TypeError('Failed to fetch'), 'Couldn’t save', { onRetry });
    const [message, , opts] = pushToast.mock.calls[0]!;
    expect(message).toContain('The Argus server isn’t responding');
    expect(opts?.action?.label).toBe('Retry');
    await opts!.action!.run();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
