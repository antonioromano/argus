import { describe, it, expect, beforeEach } from 'vitest';
import { readViewMode, writeViewMode } from './useChatViewMode.js';

describe('session view mode storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to the terminal', () => {
    expect(readViewMode('s1')).toBe('terminal');
  });

  it('remembers chat per session and forgets it when switched back', () => {
    writeViewMode('s1', 'chat');
    expect(readViewMode('s1')).toBe('chat');
    expect(readViewMode('s2')).toBe('terminal');
    writeViewMode('s1', 'terminal');
    expect(readViewMode('s1')).toBe('terminal');
    expect(window.localStorage.getItem('argus.sessionViewMode')).toBe('{}');
  });

  it('survives corrupt storage', () => {
    window.localStorage.setItem('argus.sessionViewMode', '{nope');
    expect(readViewMode('s1')).toBe('terminal');
    writeViewMode('s1', 'chat');
    expect(readViewMode('s1')).toBe('chat');
  });
});
