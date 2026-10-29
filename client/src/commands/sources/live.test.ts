import { describe, it, expect, vi } from 'vitest';
import { liveSource } from './live.js';
import { stubContext } from './testContext.js';

const find = (cmds: ReturnType<typeof liveSource>, id: string) => cmds.find((c) => c.id === id);

describe('liveSource', () => {
  it('filters to each group and offers Show all only while filtered', () => {
    const setActiveGroup = vi.fn();
    const groups = [{ id: 'g1', name: 'Infra' }];
    const plain = liveSource(stubContext({ groups, setActiveGroup }));
    expect(find(plain, 'group:all')).toBeUndefined();
    find(plain, 'group:g1')!.run();
    expect(setActiveGroup).toHaveBeenCalledWith('g1');
    const filtered = liveSource(stubContext({ groups, activeGroupId: 'g1', setActiveGroup }));
    expect(find(filtered, 'group:g1')!.checked).toBe(true);
    find(filtered, 'group:all')!.run();
    expect(setActiveGroup).toHaveBeenLastCalledWith(null);
  });

  it('arms the toolbar keep-awake windows and disarms only while armed', () => {
    const armKeepAwake = vi.fn();
    const cmds = liveSource(stubContext({ armKeepAwake }));
    find(cmds, `keepawake:${30 * 60_000}`)!.run();
    expect(armKeepAwake).toHaveBeenCalledWith(30 * 60_000);
    find(cmds, 'keepawake:indefinite')!.run();
    expect(armKeepAwake).toHaveBeenLastCalledWith(null);
    expect(find(cmds, 'keepawake:off')!.when).toBe(false);
    const armed = liveSource(stubContext({ keepAwake: { active: true, expiresAt: null, indefinite: true } }));
    expect(find(armed, 'keepawake:off')!.when).toBe(true);
  });

  it('hides Stop remote access while disconnected and Start while connected', () => {
    const down = liveSource(stubContext({ tunnelStatus: 'disconnected' }));
    expect(find(down, 'remote:stop')!.when).toBe(false);
    expect(find(down, 'remote:start')!.when).toBe(true);
    const up = liveSource(stubContext({ tunnelStatus: 'connected' }));
    expect(find(up, 'remote:stop')!.when).toBe(true);
    expect(find(up, 'remote:start')!.when).toBe(false);
  });

  it('hides Install update without one', () => {
    expect(find(liveSource(stubContext()), 'update:install')!.when).toBe(false);
    const c = find(liveSource(stubContext({ updateVersion: '0.30.0' })), 'update:install')!;
    expect(c.when).toBe(true);
    expect(c.title).toBe('Install update 0.30.0');
  });
});
