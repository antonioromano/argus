import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { OrphanReport } from '@argus/shared';
import { OrphanAgentsSection } from './OrphanAgentsSection.js';

const mocks = vi.hoisted(() => ({ getOrphans: vi.fn(), killOrphans: vi.fn(), push: vi.fn() }));
vi.mock('../../../../services/api.js', () => ({ api: { getOrphans: mocks.getOrphans, killOrphans: mocks.killOrphans } }));
vi.mock('../../../../components/primitives/index.js', async (orig) => ({
  ...(await orig<typeof import('../../../../components/primitives/index.js')>()),
  pushToast: mocks.push,
}));

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const REPORT: OrphanReport = {
  daemons: [{ kind: 'argusd', label: 'argus', pid: 200, alive: true, sessionIds: ['s1'], childPids: [201], treeRssKb: 900 * 1024 }],
  agents: [{ pid: 201, agent: 'claude', command: 'claude --settings x', cwd: '/Users/me/proj', rssKb: 880 * 1024, daemonPid: 200, sessionId: 's1' }],
  totalRssKb: 900 * 1024,
};

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.getOrphans.mockReset().mockResolvedValue(REPORT);
  mocks.killOrphans.mockReset().mockResolvedValue({ accepted: [200], rejected: [], signalled: [201, 200], forceKilled: [] });
  mocks.push.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render() {
  await act(async () => { root.render(<OrphanAgentsSection />); await Promise.resolve(); });
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

describe('OrphanAgentsSection', () => {
  it('empty state', async () => {
    mocks.getOrphans.mockResolvedValue({ daemons: [], agents: [], totalRssKb: 0 });
    await render();
    expect(container.textContent).toContain('No orphan daemons');
    expect(button('Kill selected')).toBeUndefined();
  });

  it('lists daemons with their agents and the total RSS', async () => {
    await render();
    expect(container.querySelectorAll('[data-testid="orphan-daemon"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="orphan-total"]')?.textContent).toBe('900 MB');
    expect(container.textContent).toContain('argusd · argus · pid 200');
    expect(container.textContent).toContain('claude · pid 201 · 880 MB · /Users/me/proj');
  });

  it('kills only after the in-page confirmation, then rescans', async () => {
    await render();
    expect(button('Kill selected')?.disabled).toBe(true);
    await act(async () => { (container.querySelector('[role="checkbox"]') as HTMLElement).click(); });
    await act(async () => { button('Kill selected')!.click(); });
    expect(mocks.killOrphans).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Stop 1 daemon(s) and their agents (900 MB)?');
    mocks.getOrphans.mockResolvedValue({ daemons: [], agents: [], totalRssKb: 0 });
    await act(async () => { button('Kill')!.click(); await Promise.resolve(); });
    expect(mocks.killOrphans).toHaveBeenCalledWith([200]);
    expect(mocks.push).toHaveBeenCalledWith('Stopped 1 daemon(s)', 'ok');
    expect(container.textContent).toContain('No orphan daemons');
  });

  it('cancel leaves everything running', async () => {
    await render();
    await act(async () => { (container.querySelector('[role="checkbox"]') as HTMLElement).click(); });
    await act(async () => { button('Kill selected')!.click(); });
    await act(async () => { button('Cancel')!.click(); });
    expect(mocks.killOrphans).not.toHaveBeenCalled();
    expect(button('Kill selected')).toBeDefined();
  });
});
