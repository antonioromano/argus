import { describe, it, expect } from 'vitest';
import { boosted, browseCommands, matchScore, rankCommands, recentCommands, suggestedCommands } from './rank.js';
import type { Command } from './types.js';

const cmd = (id: string, title: string, over: Partial<Command> = {}): Command => ({
  id, title, category: 'View', source: 'test', run: () => {}, ...over,
});

describe('matchScore', () => {
  it('finds an abbreviation as a subsequence, and prefers the better title', () => {
    expect(matchScore('tgl thm', 'Toggle theme')).toBeGreaterThan(matchScore('tgl thm', 'Settings: Toolbar'));
    expect(matchScore('tgl thm', 'Settings: Toolbar')).toBe(0);
  });

  it('scores a word-start hit above a mid-word one', () => {
    expect(matchScore('dif', 'Open diff')).toBeGreaterThan(matchScore('dif', 'Modified'));
  });

  it('matches keywords at reduced weight', () => {
    const viaKeyword = matchScore('caffeinate', 'Keep Mac awake', 'sleep caffeinate power');
    expect(viaKeyword).toBeGreaterThan(0);
    expect(viaKeyword).toBeLessThan(matchScore('caffeinate', 'Caffeinate'));
  });

  it('returns 0 for an empty query', () => {
    expect(matchScore('  ', 'Anything')).toBe(0);
  });
});

describe('rankCommands', () => {
  it('a frecency boost cannot lift a non-match', () => {
    expect(boosted(0, 10_000)).toBe(0);
    const groups = rankCommands([cmd('a', 'Zoom In')], 'theme', new Map([['a', 10_000]]));
    expect(groups).toEqual([]);
  });

  it('boosts a frequently used command among equal matches', () => {
    const list = [cmd('a', 'Show clock'), cmd('b', 'Show clock')];
    const [g] = rankCommands(list, 'clock', new Map([['b', 500]]));
    expect(g.commands.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('keeps registry order on ties', () => {
    const list = [cmd('a', 'Zoom In'), cmd('b', 'Zoom In'), cmd('c', 'Zoom In')];
    expect(rankCommands(list, 'zoom')[0].commands.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('groups by category with the best-scoring group first', () => {
    const list = [
      cmd('s', 'Theme settings…', { category: 'Settings' }),
      cmd('v', 'Theme', { category: 'View' }),
      cmd('h', 'Help with theme', { category: 'Help' }),
    ];
    const groups = rankCommands(list, 'theme');
    expect(groups.map((g) => g.category)).toEqual(['View', 'Settings', 'Help']);
  });
});

describe('empty-query views', () => {
  const list = [
    cmd('shortcut:new-session', 'New Session…', { category: 'Sessions' }),
    cmd('view:broadcast', 'Broadcast input…', { category: 'Sessions' }),
    cmd('menu:zoom-in', 'Zoom In'),
  ];

  it('Recent is the top commands by frecency, never-run ones skipped', () => {
    const recent = recentCommands(list, new Map([['menu:zoom-in', 300], ['view:broadcast', 100]]));
    expect(recent.map((c) => c.id)).toEqual(['menu:zoom-in', 'view:broadcast']);
  });

  it('Suggested follows the fixed order, skipping absent and recent ids', () => {
    expect(suggestedCommands(list).map((c) => c.id)).toEqual(['shortcut:new-session', 'view:broadcast']);
    expect(suggestedCommands(list, [list[1]]).map((c) => c.id)).toEqual(['shortcut:new-session']);
  });

  it('browse lists every command in category order', () => {
    expect(browseCommands(list).map((g) => g.category)).toEqual(['Sessions', 'View']);
  });
});
