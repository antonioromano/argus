import { describe, it, expect } from 'vitest';
import { NGROK_PW_MIN, isNgrokPasswordValid } from './passwordRules';

describe('isNgrokPasswordValid', () => {
  it('requires at least NGROK_PW_MIN characters', () => {
    expect(NGROK_PW_MIN).toBe(12);
    expect(isNgrokPasswordValid('a'.repeat(NGROK_PW_MIN - 1))).toBe(false);
    expect(isNgrokPasswordValid('a'.repeat(NGROK_PW_MIN))).toBe(true);
    expect(isNgrokPasswordValid('')).toBe(false);
  });
});
