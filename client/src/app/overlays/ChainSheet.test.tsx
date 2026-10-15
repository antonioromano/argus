import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type SessionInfo } from '@argus/shared';
import { ChainHost, ChainSheet } from './ChainSheet.js';
import { chainTargets } from './chains.js';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../services/api.js', () => ({ api: { createChain: mocks.create } }));

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const S = (id: string, name: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  id, name, folderPath: `/repo/${name}`, status: 'idle', createdAt: '', agentType: 'claude', flags: [], ...extra,
});
const SOURCE = S('a', 'api', { status: 'running' });
const SESSIONS = [
  SOURCE,
  S('b', 'client'),
  S('c', 'reviewer', { agentType: 'codex', status: 'running' }),
  S('sh', 'zsh', { agentType: 'shell' }),
  S('x', 'dead', { status: 'exited' }),
];

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.create.mockReset().mockImplementation(async (req) => ({ id: 'c1', armed: true, fireCount: 0, createdAt: '', mode: 'once', ...req }));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const radio = (label: string) => [...document.querySelectorAll('[role="radio"]')].find((r) => r.textContent?.trim() === label) as HTMLElement;
const type = async (el: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

async function render(onCreated = vi.fn(), onClose = vi.fn(), sessions = SESSIONS) {
  await act(async () => { root.render(<ChainSheet session={SOURCE} sessions={sessions} onClose={onClose} onCreated={onCreated} />); });
  return { onCreated, onClose };
}

describe('chainTargets', () => {
  it('excludes the source, exited sessions and plain shells', () => {
    expect(chainTargets(SOURCE, SESSIONS).map((s) => s.id)).toEqual(['b', 'c']);
  });
});

describe('ChainSheet', () => {
  it('offers only valid targets and needs a prompt before it can confirm', async () => {
    await render();
    expect(q('chain-sheet')).toBeTruthy();
    const options = [...(q('chain-target') as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(['b', 'c']);
    expect(button('Create chain')!.disabled).toBe(true);
    await type(q('chain-prompt') as HTMLTextAreaElement, '   ');
    expect(button('Create chain')!.disabled).toBe(true);
  });

  it('creates the chain with the chosen target, trigger, mode and prompt (newlines flattened)', async () => {
    const { onCreated, onClose } = await render();
    await act(async () => {
      const sel = q('chain-target') as HTMLSelectElement;
      sel.value = 'c';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { radio('Waiting').click(); });
    await act(async () => { radio('Repeat').click(); });
    await type(q('chain-prompt') as HTMLTextAreaElement, 'review the diff\nand report');
    expect(q('chain-summary')!.textContent).toBe('When api goes waiting, type the prompt into reviewer (every time).');
    await act(async () => { button('Create chain')!.click(); });
    expect(mocks.create).toHaveBeenCalledWith({ sourceId: 'a', targetId: 'c', trigger: 'waiting', mode: 'repeat', prompt: 'review the diff and report' });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('defaults to idle + once', async () => {
    await render();
    await type(q('chain-prompt') as HTMLTextAreaElement, 'go');
    await act(async () => { button('Create chain')!.click(); });
    expect(mocks.create).toHaveBeenCalledWith({ sourceId: 'a', targetId: 'b', trigger: 'idle', mode: 'once', prompt: 'go' });
  });

  it('blocks a prompt over 4000 characters', async () => {
    await render();
    await type(q('chain-prompt') as HTMLTextAreaElement, 'x'.repeat(4001));
    expect(q('chain-count')!.textContent).toBe('4001 / 4000');
    expect(button('Create chain')!.disabled).toBe(true);
  });

  it('shows the server error (e.g. a repeat loop) and stays open', async () => {
    mocks.create.mockRejectedValue(new Error('This would close a loop of repeat chains'));
    const { onCreated, onClose } = await render();
    await type(q('chain-prompt') as HTMLTextAreaElement, 'go');
    await act(async () => { button('Create chain')!.click(); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('loop');
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says so when there is no agent shell to chain to', async () => {
    await render(vi.fn(), vi.fn(), [SOURCE, S('sh', 'zsh', { agentType: 'shell' })]);
    expect(q('chain-summary')!.textContent).toBe('No agent shell to chain to.');
    expect(button('Create chain')!.disabled).toBe(true);
  });
});

describe('ChainHost', () => {
  it('renders nothing while the flag is off', async () => {
    await act(async () => { root.render(<ChainHost config={DEFAULT_CONFIG} session={SOURCE} sessions={SESSIONS} onClose={vi.fn()} />); });
    expect(q('chain-sheet')).toBeNull();
  });

  it('renders the sheet when the flag is on', async () => {
    await act(async () => { root.render(<ChainHost config={{ ...DEFAULT_CONFIG, betaSessionChains: true }} session={SOURCE} sessions={SESSIONS} onClose={vi.fn()} />); });
    expect(q('chain-sheet')).toBeTruthy();
  });
});
