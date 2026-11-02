import { describe, it, expect, beforeEach, vi } from 'vitest';

const push = vi.fn();
vi.mock('../components/primitives/index.js', () => ({ pushToast: (...a: unknown[]) => push(...a) }));
const getOrphans = vi.fn();
vi.mock('../services/api.js', () => ({ api: { getOrphans: (...a: unknown[]) => getOrphans(...a) } }));

import { checkOrphansOnStartup, resetOrphanStartupCheck } from './orphanStartupCheck.js';

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  push.mockReset();
  getOrphans.mockReset();
  resetOrphanStartupCheck();
});

describe('orphan startup check (V2)', () => {
  it('is a warn toast with a Review action that opens Settings → Runtime', async () => {
    getOrphans.mockResolvedValue({ notify: true, daemons: [{}], agents: [{}, {}], totalRssKb: 2048 });
    const review = vi.fn();
    checkOrphansOnStartup(review);
    await flush();
    expect(push).toHaveBeenCalledTimes(1);
    const [message, tone, opts] = push.mock.calls[0];
    expect(tone).toBe('warn');
    expect(message).toBe('2 orphan agents under 1 stale daemon are using 2 MB.');
    expect(message).not.toContain('Settings');
    expect(opts.action.label).toBe('Review');
    opts.action.run();
    expect(review).toHaveBeenCalled();
  });

  it('says nothing when the server does not ask to notify, and runs once', async () => {
    getOrphans.mockResolvedValue({ notify: false, daemons: [{}], agents: [], totalRssKb: 0 });
    checkOrphansOnStartup(() => {});
    checkOrphansOnStartup(() => {});
    await flush();
    expect(getOrphans).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});
