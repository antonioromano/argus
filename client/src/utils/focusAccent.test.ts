import { describe, it, expect } from 'vitest';
import { pickFocusAccent } from './focusAccent.js';

describe('pickFocusAccent', () => {
  it('uses the system blue in dark (clears 3:1 on the panel and the card)', () => {
    expect(pickFocusAccent('#0a84ff', 'dark')).toBe('#0a84ff');
  });

  it('falls back to the brand accent when the system colour fails 3:1', () => {
    // Graphite #989898 on white --bg-2 is about 2.9:1.
    expect(pickFocusAccent('#989898', 'light')).toBeNull();
    // System yellow on the light panel is far below 3:1.
    expect(pickFocusAccent('#ffc600', 'light')).toBeNull();
  });

  it('keeps an accent that passes in light', () => {
    expect(pickFocusAccent('#007aff', 'light')).toBe('#007aff');
  });

  it('returns null for no accent or a malformed one', () => {
    expect(pickFocusAccent(null, 'dark')).toBeNull();
    expect(pickFocusAccent('blue', 'dark')).toBeNull();
  });
});
