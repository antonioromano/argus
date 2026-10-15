import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '@argus/shared';
import { BETA_FEATURES, isBetaEnabled } from './betaFlags.js';

describe('isBetaEnabled', () => {
  it('is on only for an explicit true', () => {
    expect(isBetaEnabled({ betaWorktreeLifecycle: true }, 'betaWorktreeLifecycle')).toBe(true);
    expect(isBetaEnabled({ betaWorktreeLifecycle: false }, 'betaWorktreeLifecycle')).toBe(false);
    expect(isBetaEnabled({}, 'betaWorktreeLifecycle')).toBe(false);
    expect(isBetaEnabled(null, 'betaWorktreeLifecycle')).toBe(false);
    expect(isBetaEnabled(undefined, 'betaWorktreeLifecycle')).toBe(false);
  });

  it('every beta flag ships off', () => {
    for (const f of BETA_FEATURES) expect(isBetaEnabled(DEFAULT_CONFIG, f.flag)).toBe(false);
  });
});
