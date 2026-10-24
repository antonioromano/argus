import { describe, it, expect } from 'vitest';
import { commitAge } from './gitFormat.js';

describe('commitAge', () => {
  const now = new Date(2026, 9, 24, 12, 0, 0).getTime();
  it('counts minutes, hours and days, then shows the date', () => {
    expect(commitAge(now - 10_000, now)).toBe('just now');
    expect(commitAge(now + 3_600_000, now)).toBe('just now');
    expect(commitAge(now - 5 * 60_000, now)).toBe('5m ago');
    expect(commitAge(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(commitAge(now - 12 * 86_400_000, now)).toBe('12d ago');
    expect(commitAge(new Date(2026, 2, 4, 9).getTime(), now)).toBe('Mar 4');
    expect(commitAge(new Date(2024, 2, 4, 9).getTime(), now)).toBe('Mar 4, 2024');
  });
});
