import { describe, it, expect } from 'vitest';
import { KEEP_AWAKE_OPTIONS, formatRemaining, remainingMs } from './keepAwakeFormat.js';

describe('KEEP_AWAKE_OPTIONS', () => {
  it('offers exactly the seven designed windows, indefinite last', () => {
    expect(KEEP_AWAKE_OPTIONS.map((o) => o.durationMs)).toEqual([
      5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 120 * 60_000, 240 * 60_000, null,
    ]);
    expect(KEEP_AWAKE_OPTIONS.map((o) => o.hint)).toEqual(['5m', '15m', '30m', '1h', '2h', '4h', '∞']);
  });
});

describe('formatRemaining', () => {
  it('renders M:SS below an hour', () => {
    expect(formatRemaining(5 * 60_000)).toBe('5:00');
    expect(formatRemaining(59_000)).toBe('0:59');
    expect(formatRemaining(9_000)).toBe('0:09');
  });

  it('renders H:MM:SS at or above an hour', () => {
    expect(formatRemaining(60 * 60_000)).toBe('1:00:00');
    expect(formatRemaining(2 * 60 * 60_000 - 1_000)).toBe('1:59:59');
    expect(formatRemaining(4 * 60 * 60_000)).toBe('4:00:00');
  });

  it('rounds up so a fresh window never shows one second short', () => {
    // A just-armed 30m window is a hair under 30:00 by the time it renders.
    expect(formatRemaining(30 * 60_000 - 1)).toBe('30:00');
    expect(formatRemaining(29 * 60_000 + 59_999)).toBe('30:00');
    // Sub-second rounding is up, not down: 29m 0.999s reads 29:01, never 29:00.
    expect(formatRemaining(29 * 60_000 + 999)).toBe('29:01');
  });

  it('clamps at zero rather than going negative', () => {
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(-5_000)).toBe('0:00');
  });
});

describe('remainingMs', () => {
  it('is the gap between expiry and now', () => {
    expect(remainingMs(1_000_000 + 30_000, 1_000_000)).toBe(30_000);
  });

  it('is zero once expired', () => {
    expect(remainingMs(1_000_000, 1_500_000)).toBe(0);
  });

  it('is zero when there is no expiry (off, or indefinite)', () => {
    expect(remainingMs(null, 1_000_000)).toBe(0);
  });
});
