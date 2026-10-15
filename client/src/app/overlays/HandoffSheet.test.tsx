import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AppConfig, SessionInfo } from '@argus/shared';
import { DEFAULT_CONFIG } from '@argus/shared';
import { HandoffHost, HandoffSheet } from './HandoffSheet.js';
import { formatBytes } from './handoff.js';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), handoff: vi.fn() }));
vi.mock('../../services/api.js', () => ({
  api: { previewHandoff: mocks.preview, handoffSession: mocks.handoff },
}));

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const SESSION: SessionInfo = {
  id: 's1', name: 'api', folderPath: '/repo/api', status: 'idle', createdAt: '', agentType: 'claude', flags: [],
};
const CONFIG: AppConfig = { ...DEFAULT_CONFIG, betaHandoff: true };

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.preview.mockReset().mockResolvedValue({ preview: true, bytes: 12_800, messages: 10, isGitRepo: true, diffTruncated: true });
  mocks.handoff.mockReset().mockResolvedValue({ preview: false, bytes: 1, messages: 0, isGitRepo: true, diffTruncated: false, briefPath: '/d/h.md', session: { ...SESSION, id: 'new1', name: 'api (handoff)' } });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 350)); }); };
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

async function render(session = SESSION, onCreated = vi.fn(), onClose = vi.fn()) {
  await act(async () => { root.render(<HandoffSheet session={session} config={CONFIG} onClose={onClose} onCreated={onCreated} />); });
  await settle();
  return { onCreated, onClose };
}

describe('formatBytes', () => {
  it('shows bytes, then KB', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(12_800)).toBe('12.5 KB');
  });
});

describe('HandoffSheet', () => {
  it('prefills the folder and the source agent, and previews the brief size', async () => {
    await render();
    expect(q('handoff-sheet')).toBeTruthy();
    expect((document.querySelector('input[type="text"], input:not([type])') as HTMLInputElement).value).toBe('/repo/api');
    const claude = [...document.querySelectorAll('[role="radio"]')].find((r) => r.textContent?.includes('Claude'));
    expect(claude?.getAttribute('aria-checked')).toBe('true');
    // A plain shell is never offered as the target.
    expect([...document.querySelectorAll('[role="radio"]')].some((r) => r.textContent?.trim() === 'Shell')).toBe(false);
    expect(mocks.preview).toHaveBeenCalledWith('s1', { agentType: 'claude', folderPath: '/repo/api', messageCount: 10, includeDiff: true, note: '' }, expect.any(AbortSignal));
    expect(q('handoff-preview')!.textContent).toBe('Brief ≈ 12.5 KB · 10 messages · diff truncated');
  });

  it('re-previews when the diff is unchecked', async () => {
    await render();
    await act(async () => { (q('handoff-diff')!.querySelector('[role="checkbox"]') as HTMLElement).click(); });
    await settle();
    expect(mocks.preview).toHaveBeenLastCalledWith('s1', expect.objectContaining({ includeDiff: false }), expect.any(AbortSignal));
  });

  it('shows a preview error (e.g. a bad folder)', async () => {
    mocks.preview.mockRejectedValue(new Error('Folder does not exist: /nope'));
    await render();
    expect(q('handoff-preview')!.textContent).toContain('Folder does not exist');
  });

  it('confirm sends the options and hands the new session to the host', async () => {
    const { onCreated, onClose } = await render();
    const note = q('handoff-note') as HTMLTextAreaElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(note, 'finish the tests');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { button('Hand off')!.click(); });
    await settle();
    expect(mocks.handoff).toHaveBeenCalledWith('s1', { agentType: 'claude', folderPath: '/repo/api', messageCount: 10, includeDiff: true, note: 'finish the tests' });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the sheet open with the error when the handoff fails', async () => {
    mocks.handoff.mockRejectedValue(new Error('Unknown agent type'));
    const { onCreated, onClose } = await render();
    await act(async () => { button('Hand off')!.click(); });
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Unknown agent type');
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables the message count for a non-Claude source', async () => {
    await render({ ...SESSION, agentType: 'codex' });
    expect((q('handoff-count') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('HandoffHost', () => {
  it('renders nothing and fetches nothing while the flag is off', async () => {
    await act(async () => { root.render(<HandoffHost config={{ ...DEFAULT_CONFIG, betaHandoff: false }} session={SESSION} onClose={vi.fn()} onCreated={vi.fn()} />); });
    await settle();
    expect(q('handoff-sheet')).toBeNull();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('renders the sheet when the flag is on', async () => {
    await act(async () => { root.render(<HandoffHost config={CONFIG} session={SESSION} onClose={vi.fn()} onCreated={vi.fn()} />); });
    await settle();
    expect(q('handoff-sheet')).toBeTruthy();
  });
});
