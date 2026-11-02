import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@argus/shared';
import { BETA_FEATURES } from '../../utils/betaFlags.js';
import { betaSource } from './beta.js';
import { stubContext } from './testContext.js';

describe('betaSource', () => {
  it('offers Enable while off and toasts the HOW line on enable', () => {
    const updateConfig = vi.fn();
    const toast = vi.fn();
    const f = BETA_FEATURES[0];
    const cmds = betaSource(stubContext({ updateConfig, toast }));
    expect(cmds.find((c) => c.id === `beta:${f.flag}:off`)!.when).toBe(false);
    const on = cmds.find((c) => c.id === `beta:${f.flag}:on`)!;
    expect(on.when).toBe(true);
    on.run();
    expect(updateConfig).toHaveBeenCalledWith({ [f.flag]: true });
    expect(toast.mock.calls[0][0]).toContain(f.how);
  });

  it('offers Disable while on', () => {
    const updateConfig = vi.fn();
    const f = BETA_FEATURES[1];
    const off = betaSource(stubContext({ config: { ...DEFAULT_CONFIG, [f.flag]: true }, updateConfig }))
      .find((c) => c.id === `beta:${f.flag}:off`)!;
    expect(off.when).toBe(true);
    off.run();
    expect(updateConfig).toHaveBeenCalledWith({ [f.flag]: false });
  });
});
