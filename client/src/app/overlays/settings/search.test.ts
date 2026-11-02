import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { searchSettings, visiblePanes } from './search.js';

const base = (): AppConfig => structuredClone(DEFAULT_CONFIG);
const ids = (q: string, config?: AppConfig) => searchSettings(q, config).map((h) => h.setting.id);

describe('searchSettings', () => {
  it('returns nothing for an empty query', () => {
    expect(searchSettings('')).toEqual([]);
    expect(searchSettings('   ')).toEqual([]);
  });

  it('finds the seconds toggle first for "seconds"', () => {
    expect(ids('seconds')[0]).toBe('clockShowSeconds');
  });

  it('ranks a label prefix above a label substring above a keyword match', () => {
    const hits = searchSettings('show');
    const ranks = hits.map((h) => h.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    // "Show clock in status bar" starts with the query; "Usage meter" only has it as a keyword.
    expect(ids('show').indexOf('showClock')).toBeLessThan(ids('show').indexOf('showUsageMeter'));
  });

  it('finds both inspector controls on Shell header, label match first', () => {
    const onHeader = searchSettings('inspector').filter((h) => h.setting.pane === 'shell-header');
    expect(onHeader.map((h) => h.setting.id)).toEqual(['inspectorVisible', 'inspectorSide']);
  });

  it('is case-insensitive', () => {
    expect(ids('SECONDS')[0]).toBe('clockShowSeconds');
  });

  it('matches hints and section titles', () => {
    expect(ids('hh:mm:ss')).toContain('clockShowSeconds');
    expect(ids('font sizes')).toEqual(expect.arrayContaining(['codeFontSize', 'uiFontSize']));
  });

  it('marks a hidden control and points at what reveals it', () => {
    const [hit] = searchSettings('seconds', { ...base(), showClock: false });
    expect(hit.hidden).toBe(true);
    expect(hit.revealVia?.id).toBe('showClock');
    const [shown] = searchSettings('seconds', { ...base(), showClock: true });
    expect(shown.hidden).toBe(false);
  });

  it('finds generated shortcut and beta settings', () => {
    expect(ids('new session')).toContain('shortcut:new-session');
    expect(ids('handoff')).toContain('beta:betaHandoff');
  });
});

describe('visiblePanes', () => {
  it('keeps pane-level keywords working ("tmux" → Runtime)', () => {
    expect(visiblePanes('tmux').map((p) => p.id)).toEqual(['runtime']);
  });

  it('shows a pane whose only match is one of its controls', () => {
    expect(visiblePanes('hh:mm:ss').map((p) => p.id)).toEqual(['theme']);
  });

  it('shows every pane for an empty query', () => {
    expect(visiblePanes('').length).toBe(12);
  });
});
