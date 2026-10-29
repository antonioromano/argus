import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig, type SessionInfo } from '@argus/shared';
import { promosFor, runBetaPromo, templatesPromoVisible } from './betaPromos.js';
import { EMPTY_DISCOVERY } from './discoveryState.js';

const session = (over: Partial<SessionInfo> = {}) =>
  ({ id: 's1', name: 'a', folderPath: '/r', status: 'idle', agentType: 'claude', ...over }) as SessionInfo;
const config = (over: Partial<AppConfig> = {}) => ({ ...structuredClone(DEFAULT_CONFIG), ...over }) as AppConfig;
const flags = (s: SessionInfo, o: { config?: AppConfig; liveCount?: number; hidden?: string[] } = {}) =>
  promosFor(s, {
    config: o.config ?? config(),
    liveCount: o.liveCount ?? 1,
    discovery: { ...EMPTY_DISCOVERY, betaPromosHidden: o.hidden ?? [] },
  }).map((p) => p.flag);

describe('promosFor', () => {
  it('offers at most two, in order', () => {
    expect(flags(session({ worktreePath: '/w', worktreeBranch: 'b' }), { liveCount: 3 })).toEqual(['betaHandoff', 'betaSessionChains']);
  });

  it('skips a flag that is already on', () => {
    expect(flags(session(), { config: config({ betaHandoff: true }) })).toEqual(['betaActivityTimeline']);
  });

  it('chains need two live sessions', () => {
    expect(flags(session(), { config: config({ betaHandoff: true }), liveCount: 1 })).not.toContain('betaSessionChains');
    expect(flags(session(), { config: config({ betaHandoff: true }), liveCount: 2 })).toContain('betaSessionChains');
  });

  it('finish only on a worktree session', () => {
    const on = config({ betaHandoff: true, betaSessionChains: true });
    expect(flags(session(), { config: on })).not.toContain('betaWorktreeLifecycle');
    expect(flags(session({ worktreePath: '/w', worktreeBranch: 'b' }), { config: on })).toContain('betaWorktreeLifecycle');
  });

  it('activity only for Claude; nothing session-bound for an exited non-worktree session', () => {
    expect(flags(session({ agentType: 'codex', status: 'exited' }))).toEqual([]);
  });

  it('a dismissed flag and "*" hide promos', () => {
    expect(flags(session(), { hidden: ['betaHandoff'] })).toEqual(['betaActivityTimeline']);
    expect(flags(session(), { hidden: ['*'] })).toEqual([]);
  });
});

describe('templatesPromoVisible', () => {
  it('shows until the flag is on or the promo is hidden', () => {
    expect(templatesPromoVisible(config(), EMPTY_DISCOVERY)).toBe(true);
    expect(templatesPromoVisible(config({ betaSessionTemplates: true }), EMPTY_DISCOVERY)).toBe(false);
    expect(templatesPromoVisible(config(), { ...EMPTY_DISCOVERY, betaPromosHidden: ['betaSessionTemplates'] })).toBe(false);
    expect(templatesPromoVisible(null, EMPTY_DISCOVERY)).toBe(false);
  });
});

describe('runBetaPromo', () => {
  const deps = () => ({
    enable: vi.fn(async () => {}), openHandoff: vi.fn(), openChain: vi.fn(), openFinish: vi.fn(), openActivity: vi.fn(), toast: vi.fn(),
  });

  it('enables the flag before opening the feature on this session', async () => {
    const d = deps();
    const order: string[] = [];
    d.enable.mockImplementation(async () => { order.push('enable'); });
    d.openHandoff.mockImplementation(() => { order.push('open'); });
    const s = session();
    await runBetaPromo({ flag: 'betaHandoff', label: 'Hand off' }, s, d);
    expect(d.enable).toHaveBeenCalledWith('betaHandoff');
    expect(d.openHandoff).toHaveBeenCalledWith(s);
    expect(order).toEqual(['enable', 'open']);
    expect(d.toast.mock.calls[0][0]).toContain('Settings → Beta');
  });

  it.each([
    ['betaSessionChains', 'openChain'],
    ['betaWorktreeLifecycle', 'openFinish'],
  ] as const)('%s opens %s', async (flag, opener) => {
    const d = deps();
    await runBetaPromo({ flag, label: 'x' }, session(), d);
    expect(d[opener]).toHaveBeenCalledTimes(1);
  });

  it('activity opens the panel and warns that only new or restarted sessions record', async () => {
    const d = deps();
    await runBetaPromo({ flag: 'betaActivityTimeline', label: 'x' }, session(), d);
    expect(d.openActivity).toHaveBeenCalledTimes(1);
    expect(d.toast.mock.calls[0][0]).toMatch(/Restart the session/);
  });
});
