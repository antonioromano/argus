import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChainFire, SessionChain } from '@argus/shared';
import { ChainsSection } from './ChainsSection.js';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), audit: vi.fn(), sessions: vi.fn(), arm: vi.fn(), del: vi.fn(),
  handlers: new Map<string, () => void>(),
}));
vi.mock('../../../../services/api.js', () => ({
  api: { listChains: mocks.list, chainAudit: mocks.audit, getSessions: mocks.sessions, setChainArmed: mocks.arm, deleteChain: mocks.del },
}));
vi.mock('../../../../hooks/useSocket.js', () => {
  const socket = {
    on: (e: string, fn: () => void) => { mocks.handlers.set(e, fn); },
    off: (e: string) => { mocks.handlers.delete(e); },
  };
  return { useSocket: () => socket };
});

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const CHAIN: SessionChain = {
  id: 'c1', sourceId: 'a', targetId: 'b', trigger: 'idle', mode: 'repeat', prompt: 'run the tests', armed: false,
  disarmedReason: 'Fired 10 times within an hour; disarmed to stop a loop', createdAt: '', fireCount: 10,
};
const FIRE: ChainFire = { at: '2026-10-15T10:00:00.000Z', chainId: 'c1', sourceId: 'a', targetId: 'b', outcome: 'dropped', reason: 'Target stayed busy for 10 minutes' };

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.handlers.clear();
  mocks.list.mockReset().mockResolvedValue([CHAIN]);
  mocks.audit.mockReset().mockResolvedValue([FIRE]);
  mocks.sessions.mockReset().mockResolvedValue([
    { id: 'a', name: 'api', folderPath: '/r/api', status: 'idle', createdAt: '', agentType: 'claude', flags: [] },
    { id: 'b', name: 'client', folderPath: '/r/client', status: 'idle', createdAt: '', agentType: 'claude', flags: [] },
  ]);
  mocks.arm.mockReset().mockImplementation(async (id: string, armed: boolean) => ({ ...CHAIN, id, armed, disarmedReason: undefined }));
  mocks.del.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render() {
  await act(async () => { root.render(<ChainsSection />); });
}

describe('ChainsSection', () => {
  it('lists chains with names, the disarm reason, and the recent fires', async () => {
    await render();
    const row = container.querySelector('[data-testid="chain-c1"]')!;
    expect(row.textContent).toContain('api → client');
    expect(row.textContent).toContain('on idle · repeat · fired 10×');
    expect(row.textContent).toContain('run the tests');
    expect(container.querySelector('[data-testid="chain-reason"]')!.textContent).toContain('10 times within an hour');
    const fires = container.querySelector('[data-testid="chain-fires"]')!;
    expect(fires.textContent).toContain('dropped');
    expect(fires.textContent).toContain('api → client · Target stayed busy for 10 minutes');
  });

  it('re-arms and removes a chain', async () => {
    await render();
    await act(async () => { (container.querySelector('[data-testid="chain-c1"] label > span') as HTMLElement).click(); });
    expect(mocks.arm).toHaveBeenCalledWith('c1', true);
    expect(container.querySelector('[data-testid="chain-reason"]')).toBeNull();
    await act(async () => { (container.querySelector('button[aria-label="Remove chain"]') as HTMLButtonElement).click(); });
    expect(mocks.del).toHaveBeenCalledWith('c1');
    expect(container.querySelector('[data-testid="chain-c1"]')).toBeNull();
  });

  it('refetches on chains:changed and stops listening on unmount', async () => {
    await render();
    expect(mocks.list).toHaveBeenCalledTimes(1);
    await act(async () => { mocks.handlers.get('chains:changed')!(); });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
    expect(mocks.handlers.has('chains:changed')).toBe(false);
    root = createRoot(container);
  });

  it('shows an empty state', async () => {
    mocks.list.mockResolvedValue([]);
    mocks.audit.mockResolvedValue([]);
    await render();
    expect(container.textContent).toContain('No chains yet');
    expect(container.querySelector('[data-testid="chain-fires"]')).toBeNull();
  });
});
