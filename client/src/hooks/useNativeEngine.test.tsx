import { describe, it, expect } from 'vitest';
import { resolveTerminalEngine } from './useNativeEngine.js';

describe('resolveTerminalEngine', () => {
  it('uses native only when the session asks for it and it is available', () => {
    expect(resolveTerminalEngine('native', 'web', true)).toBe(true);
  });

  it('falls back to web when the addon is unavailable, whatever the session asked for', () => {
    // The universal fallback: a preference is never a guarantee.
    expect(resolveTerminalEngine('native', 'native', false)).toBe(false);
  });

  it('an explicit web session stays web even when the default is native', () => {
    expect(resolveTerminalEngine('web', 'native', true)).toBe(false);
  });

  it('a session with no stored preference follows the app default', () => {
    expect(resolveTerminalEngine(undefined, 'native', true)).toBe(true);
    expect(resolveTerminalEngine(undefined, 'web', true)).toBe(false);
  });

  it('an unknown stored value is treated as no preference, not as native', () => {
    // Defensive: persisted state can predate a schema change.
    expect(resolveTerminalEngine('gpu' as never, 'web', true)).toBe(false);
  });
});
