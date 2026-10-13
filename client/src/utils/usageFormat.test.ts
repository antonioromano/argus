import { describe, it, expect } from 'vitest';
import type { SessionUsage } from '@argus/shared';
import { contextLevel, describeUsage, formatCost, formatTokens } from './usageFormat.js';

const usage = (over: Partial<SessionUsage> = {}): SessionUsage => ({
  inputTokens: 1200,
  outputTokens: 34_000,
  cacheCreationTokens: 50_000,
  cacheReadTokens: 2_400_000,
  totalTokens: 2_485_200,
  updatedAt: 0,
  ...over,
});

describe('usageFormat', () => {
  it('bands context % into ok / warn / high', () => {
    expect(contextLevel(0)).toBe('ok');
    expect(contextLevel(59.9)).toBe('ok');
    expect(contextLevel(60)).toBe('warn');
    expect(contextLevel(85)).toBe('high');
    expect(contextLevel(100)).toBe('high');
  });

  it('formats token counts compactly', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(45_600)).toBe('46k');
    expect(formatTokens(4_560_000)).toBe('4.6M');
    expect(formatTokens(45_600_000)).toBe('46M');
  });

  it('formats cost', () => {
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(1.234)).toBe('$1.23');
    expect(formatCost(123.4)).toBe('$123');
  });

  it('describes the breakdown, the window and the price basis', () => {
    const text = describeUsage(usage({ contextTokens: 420_000, contextWindow: 1_000_000, contextPct: 42, costUsd: 3.21, model: 'claude-opus-5-5' }));
    expect(text).toContain('Context 420k of 1.0M (42%)');
    expect(text).toContain('1.2k in, 34k out, 2.4M cache read, 50k cache write');
    expect(text).toContain('≈ $3.21 at API prices');
    expect(text).toContain('claude-opus-5-5');
  });

  it('says when a model has no price, or only some turns were priced', () => {
    expect(describeUsage(usage())).toContain('No price for this model');
    expect(describeUsage(usage({ costUsd: 1, costPartial: true }))).toContain('some turns unpriced');
  });
});
