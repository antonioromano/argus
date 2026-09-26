import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import {
  PANES,
  PANES_BY_ID,
  GROUP_ORDER,
  RESETTABLE_KEYS,
  modifiedKeys,
  modifiedPanes,
  paneMatches,
  resetPatch,
  resolvePaneId,
} from './registry.js';

const base = (): AppConfig => structuredClone(DEFAULT_CONFIG);

describe('pane registry', () => {
  it('every pane sits in a known group and has a unique id', () => {
    const ids = PANES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PANES) expect(GROUP_ORDER).toContain(p.group);
  });

  // The whole point of the re-cut: no setting may be unreachable, and no two
  // panes may claim the same key (the modified dot would light up in both).
  it('covers every editable config key exactly once', () => {
    const owned = PANES.flatMap((p) => p.keys);
    expect(new Set(owned).size).toBe(owned.length);

    const bookkeeping = new Set(['quickActionPromptedAt']);
    const uncovered = (Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[])
      .filter((k) => !bookkeeping.has(k) && !owned.includes(k));
    expect(uncovered).toEqual([]);
  });

  it('resolves legacy tab ids from before the re-cut', () => {
    expect(resolvePaneId('remote')).toBe('remote');
    expect(resolvePaneId('worktrees')).toBe('isolation');
    expect(resolvePaneId('notif')).toBe('notifications');
    expect(resolvePaneId('general')).toBe('theme');
  });

  it('falls back to the first pane for unknown or missing ids', () => {
    expect(resolvePaneId(undefined)).toBe('theme');
    expect(resolvePaneId('nope')).toBe('theme');
  });
});

describe('filter matching', () => {
  it('matches on title, group and keywords', () => {
    expect(paneMatches(PANES_BY_ID.typography, 'font')).toBe(true);
    expect(paneMatches(PANES_BY_ID.runtime, 'tmux')).toBe(true);
    expect(paneMatches(PANES_BY_ID.confirmations, 'quit')).toBe(true);
    expect(paneMatches(PANES_BY_ID.power, 'system')).toBe(true);
  });

  it('is case-insensitive and treats an empty query as match-all', () => {
    expect(paneMatches(PANES_BY_ID.keyboard, '  SHORTCUT ')).toBe(true);
    expect(PANES.every((p) => paneMatches(p, ''))).toBe(true);
  });

  it('does not match unrelated terms', () => {
    expect(paneMatches(PANES_BY_ID.power, 'ngrok')).toBe(false);
  });

  // Each pane the sidebar can reach must be reachable by typing something, or
  // the filter would hide a pane with no way to get it back.
  it('every pane is findable by at least one of its own keywords', () => {
    for (const p of PANES) {
      expect(p.keywords.length).toBeGreaterThan(0);
      expect(paneMatches(p, p.keywords[0])).toBe(true);
    }
  });
});

describe('modified detection', () => {
  it('reports nothing modified for a default config', () => {
    expect(modifiedKeys(base()).size).toBe(0);
    expect(modifiedPanes(base()).size).toBe(0);
  });

  it('flags a changed scalar and the pane that owns it', () => {
    const config = { ...base(), uiFontSize: 18 };
    expect([...modifiedKeys(config)]).toEqual(['uiFontSize']);
    expect(modifiedPanes(config).has('typography')).toBe(true);
    expect(modifiedPanes(config).has('theme')).toBe(false);
  });

  it('treats an absent key as default — the server merges defaults underneath', () => {
    const config = base();
    delete config.showClock;
    expect(modifiedKeys(config).has('showClock')).toBe(false);
  });

  it('compares structured values by content, not identity', () => {
    const same = { ...base(), keyboardShortcuts: {} };
    expect(modifiedKeys(same).has('keyboardShortcuts')).toBe(false);

    const overridden = { ...base(), keyboardShortcuts: { 'new-session': 'mod+shift+n' } };
    expect(modifiedKeys(overridden).has('keyboardShortcuts')).toBe(true);
    expect(modifiedPanes(overridden).has('keyboard')).toBe(true);
  });

  it('notices a false that overrides a true default', () => {
    const config = { ...base(), confirmCloseShell: false };
    expect(modifiedKeys(config).has('confirmCloseShell')).toBe(true);
  });
});

describe('reset all', () => {
  it('restores every resettable key to its default', () => {
    const patch = resetPatch();
    for (const key of RESETTABLE_KEYS) {
      expect(patch[key]).toEqual(DEFAULT_CONFIG[key]);
    }
    const after = { ...base(), ...patch } as AppConfig;
    expect(modifiedKeys(after).size).toBe(0);
  });

  // Reset is a preferences reset, not a data wipe: agents the user defined and
  // the flags attached to them survive it.
  it('never touches user data or one-time bookkeeping', () => {
    const patch = resetPatch();
    expect('customAgents' in patch).toBe(false);
    expect('agentFlags' in patch).toBe(false);
    expect('quickActionPromptedAt' in patch).toBe(false);
  });

  it('hands out clones, never the shared default objects', () => {
    const patch = resetPatch();
    expect(patch.keyboardShortcuts).not.toBe(DEFAULT_CONFIG.keyboardShortcuts);
  });
});
