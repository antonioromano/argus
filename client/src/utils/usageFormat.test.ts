import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig, type SessionUsage } from '@argus/shared';
import {
  describeUsage,
  friendlyModel,
  effectiveWindow,
  formatResetIn,
  formatTokens,
  meterAgent,
  normalizeParts,
  usageLevel,
  usageMeterView,
  worstLevel,
} from './usageFormat.js';

const usage = (over: Partial<SessionUsage> = {}): SessionUsage => ({
  inputTokens: 1200,
  outputTokens: 34_000,
  cacheCreationTokens: 50_000,
  cacheReadTokens: 2_400_000,
  totalTokens: 2_485_200,
  updatedAt: 0,
  ...over,
});
const view = usageMeterView(DEFAULT_CONFIG)!;
const NOW = 1_800_000_000_000;

describe('usageFormat', () => {
  it('maps a percentage to ok / amber / red by the thresholds', () => {
    const t = { amber: 70, red: 90 };
    expect(usageLevel(69.9, t)).toBe('ok');
    expect(usageLevel(70, t)).toBe('warn');
    expect(usageLevel(90, t)).toBe('high');
    expect(usageLevel(undefined, t)).toBe('ok');
    expect(worstLevel('ok', 'high', 'warn')).toBe('high');
    expect(worstLevel()).toBe('ok');
  });

  it('only Claude and Codex report usage', () => {
    expect(meterAgent('claude')).toBe('claude');
    expect(meterAgent('codex')).toBe('codex');
    expect(meterAgent('gemini')).toBeNull();
    expect(meterAgent('shell')).toBeNull();
  });

  it('formats token counts and reset times compactly', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(4_560_000)).toBe('4.6M');
    expect(formatResetIn(30_000)).toBe('<1m');
    expect(formatResetIn(45 * 60_000)).toBe('45m');
    expect(formatResetIn((2 * 60 + 19) * 60_000)).toBe('2h19m');
    expect(formatResetIn(6 * 86_400_000)).toBe('6d');
  });

  it('a window past its reset reads as reset, 0%', () => {
    expect(effectiveWindow({ usedPct: 80, resetsAt: NOW - 1, windowMinutes: 300 }, NOW)).toEqual({ usedPct: 0, windowMinutes: 300, reset: true });
    expect(effectiveWindow({ usedPct: 80, resetsAt: NOW + 1 }, NOW)!.usedPct).toBe(80);
  });

  it('view: off when the master switch is off; parts normalized; bad thresholds fall back', () => {
    expect(usageMeterView({ ...DEFAULT_CONFIG, showUsageMeter: false })).toBeNull();
    expect(normalizeParts([{ id: 'model', on: true }, { id: 'model', on: false }] as never)).toEqual([
      { id: 'model', on: true }, { id: 'ctx', on: true }, { id: 'plan', on: true }, { id: 'tok', on: false },
    ]);
    const v = usageMeterView({ ...DEFAULT_CONFIG, usageWarnPlan: { amber: 90, red: 50 } } as AppConfig)!;
    expect(v.warnPlan).toEqual({ amber: 80, red: 95 });
  });

  it('the breakdown spells out context, both windows with resets, tokens, model and thresholds; no price', () => {
    const rows = describeUsage(
      usage({ contextTokens: 420_000, contextWindow: 1_000_000, contextPct: 42, model: 'claude-opus-5-5' }),
      {
        observedAt: NOW,
        primary: { usedPct: 20, resetsAt: NOW + (2 * 60 + 19) * 60_000, windowMinutes: 300 },
        secondary: { usedPct: 31, resetsAt: NOW - 5, windowMinutes: 10_080 },
      },
      view,
      NOW,
    );
    const text = rows.map((r) => `${r.label}: ${r.value}`).join('\n');
    expect(text).toContain('Context: 420k of 1.0M (42%)');
    expect(text).toContain('Plan usage: 20% of the 5-hour window · resets in 2h19m');
    expect(text).toContain('Plan usage: 0% of the 7-day window · reset, waiting for a fresh reading');
    expect(text).toContain('1.2k in, 34k out, 2.4M cache read, 50k cache write');
    expect(text).toContain('Model: claude-opus-5-5');
    expect(text).toContain('Warns at: context 70/90% · plan 80/95%');
    expect(text).not.toContain('$');
  });
});

describe('friendlyModel', () => {
  it.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-4-5-20250929', 'Sonnet 4.5'],
    ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
    ['claude-haiku-4-5[1m]', 'Haiku 4.5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['gpt-5.5', 'gpt-5.5'],
  ])('%s → %s', (model, want) => {
    expect(friendlyModel(model)).toBe(want);
  });
});
