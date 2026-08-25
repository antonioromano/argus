import { describe, it, expect } from 'vitest';
import { MAIN_WINDOW_ID } from '@argus/shared';
import { parseWindowId } from './windowId.js';

describe('parseWindowId', () => {
  it('extracts the windowId query param', () => {
    expect(parseWindowId('?windowId=abc-123')).toBe('abc-123');
  });
  it('defaults to main when absent, empty, or malformed', () => {
    expect(parseWindowId('')).toBe(MAIN_WINDOW_ID);
    expect(parseWindowId('?other=1')).toBe(MAIN_WINDOW_ID);
    expect(parseWindowId('?windowId=')).toBe(MAIN_WINDOW_ID);
  });
});
