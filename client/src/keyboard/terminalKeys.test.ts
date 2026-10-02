import { describe, it, expect } from 'vitest';
import { macLineEditSequence } from './terminalKeys.js';

const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('macLineEditSequence', () => {
  it('maps ⌘← / ⌘→ / ⌘⌫ to start-of-line, end-of-line, kill-to-start', () => {
    expect(macLineEditSequence(key('ArrowLeft', { metaKey: true }), true)).toBe('\x01');
    expect(macLineEditSequence(key('ArrowRight', { metaKey: true }), true)).toBe('\x05');
    expect(macLineEditSequence(key('Backspace', { metaKey: true }), true)).toBe('\x15');
  });

  it('leaves everything else to xterm', () => {
    expect(macLineEditSequence(key('ArrowLeft'), true)).toBeNull();                                  // plain arrow
    expect(macLineEditSequence(key('ArrowLeft', { metaKey: true, shiftKey: true }), true)).toBeNull(); // ⌘⇧← (selection)
    expect(macLineEditSequence(key('ArrowLeft', { metaKey: true, altKey: true }), true)).toBeNull();
    expect(macLineEditSequence(key('k', { metaKey: true }), true)).toBeNull();                        // app shortcuts
    expect(macLineEditSequence(key('ArrowLeft', { metaKey: true }), false)).toBeNull();               // not macOS
  });
});
