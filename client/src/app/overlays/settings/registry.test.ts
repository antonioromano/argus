import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import {
  PANES,
  PANES_BY_ID,
  GROUP_ORDER,
  RESETTABLE_KEYS,
  USER_DATA_KEYS,
  modifiedKeys,
  modifiedPanes,
  paneMatches,
  resetPatch,
  resolvePaneId,
  type PaneId,
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

    // Layout state the inspector remembers by itself (dragged width, collapsed
    // sections): no pane edits it, so none owns it.
    const bookkeeping = new Set(['quickActionPromptedAt', 'introSeen', 'inspectorWidth', 'inspectorCollapsed']);
    const uncovered = (Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[])
      .filter((k) => !bookkeeping.has(k) && !owned.includes(k));
    expect(uncovered).toEqual([]);
  });

  it('lets Shell header own the inspector toggle but not its layout state, findable by name', () => {
    expect(PANES_BY_ID['shell-header'].keys).toContain('inspectorSide');
    expect(PANES_BY_ID['shell-header'].keys).toContain('inspectorVisible');
    expect(PANES.flatMap((p) => p.keys)).not.toContain('inspectorWidth');
    expect(PANES.flatMap((p) => p.keys)).not.toContain('inspectorCollapsed');
    expect(paneMatches(PANES_BY_ID['shell-header'], 'inspector')).toBe(true);
  });

  it('resolves legacy tab ids from before the re-cut', () => {
    expect(resolvePaneId('remote')).toBe('remote');
    expect(resolvePaneId('worktrees')).toBe('isolation');
    expect(resolvePaneId('notif')).toBe('notifications');
    // Pre-0.24 "general" now opens the pane that is actually called General.
    expect(resolvePaneId('general')).toBe('general');
  });

  it('has twelve panes after the consolidation', () => {
    expect(PANES.length).toBe(12);
    expect(PANES.map((p) => p.id)).toEqual([
      'theme', 'shell-header',
      'agents', 'isolation', 'launchers',
      'general', 'auto-approval', 'notifications', 'keyboard',
      'runtime', 'remote', 'beta',
    ]);
  });

  it('resolves the ids of merged panes to the pane that absorbed them', () => {
    expect(resolvePaneId('typography')).toBe('theme');
    expect(resolvePaneId('toolbar')).toBe('theme');
    expect(resolvePaneId('confirmations')).toBe('general');
    expect(resolvePaneId('power')).toBe('general');
    expect(resolvePaneId('groups')).toBe('general');
    expect(resolvePaneId('developer')).toBe('runtime');
  });

  it('falls back to the first pane for unknown or missing ids', () => {
    expect(resolvePaneId(undefined)).toBe('theme');
    expect(resolvePaneId('nope')).toBe('theme');
  });
});

describe('filter matching', () => {
  it('matches on title, group and keywords', () => {
    expect(paneMatches(PANES_BY_ID.theme, 'font')).toBe(true);
    expect(paneMatches(PANES_BY_ID.runtime, 'tmux')).toBe(true);
    expect(paneMatches(PANES_BY_ID.general, 'quit')).toBe(true);
    expect(paneMatches(PANES_BY_ID.runtime, 'system')).toBe(true);
  });

  it('is case-insensitive and treats an empty query as match-all', () => {
    expect(paneMatches(PANES_BY_ID.keyboard, '  SHORTCUT ')).toBe(true);
    expect(PANES.every((p) => paneMatches(p, ''))).toBe(true);
  });

  it('does not match unrelated terms', () => {
    expect(paneMatches(PANES_BY_ID.general, 'ngrok')).toBe(false);
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

/**
 * The 17 panes as they were before the consolidation, keyword lists verbatim.
 * Merging panes must not cost anyone a search term: every old word still finds
 * the pane that now holds the old pane's settings.
 */
const LEGACY_PANES: Record<string, { owner: PaneId; keys: (keyof AppConfig)[]; keywords: string[] }> = {
  theme: { owner: 'theme', keys: ['mosaicOrientation', 'mosaicWaitingStyle'], keywords: ['theme', 'dark', 'light', 'system', 'appearance', 'waiting', 'attention', 'halo', 'breathing', 'pulse', 'flag', 'mosaic', 'layout', 'stacked', 'vertical', 'horizontal', 'side by side'] },
  typography: { owner: 'theme', keys: ['codeFontSize', 'uiFontSize'], keywords: ['font', 'font size', 'text size', 'code font', 'interface font', 'terminal font', 'zoom', 'bigger', 'smaller'] },
  'shell-header': { owner: 'shell-header', keys: ['tileQuickAction', 'tileRunningIndicator', 'showUsageMeter', 'usageMeterParts', 'usageWarnContext', 'usageWarnPlan', 'showPrStatus', 'inspectorSide', 'inspectorVisible'], keywords: ['quick action', 'tile', 'header', 'running indicator', 'hairline', 'progress', 'window controls', 'usage', 'tokens', 'context', 'meter', 'plan usage', 'rate limit', 'limit', 'reset', 'model', 'warning', 'threshold', 'codex', 'pr', 'pull request', 'ci', 'checks', 'github', 'gh', 'inspector', 'session inspector', 'side panel', 'left', 'right', 'position', 'show', 'hide', 'git', 'branch'] },
  toolbar: { owner: 'theme', keys: ['showClock', 'clockShowSeconds'], keywords: ['clock', 'time', 'seconds', 'toolbar'] },
  agents: { owner: 'agents', keys: ['defaultAgent', 'customAgents', 'agentFlags', 'claudeRenderer', 'defaultSessionView'], keywords: ['agent', 'claude', 'gemini', 'codex', 'custom agent', 'flags', 'cli', 'default agent', 'command', 'renderer', 'fullscreen', 'classic', 'tui', 'duplicate', 'scrollback', 'chat', 'chat view', 'default view', 'terminal view'] },
  groups: { owner: 'general', keys: ['othersFolderName'], keywords: ['group', 'folder', 'others', 'ungrouped', 'bucket', 'name'] },
  isolation: { owner: 'isolation', keys: [], keywords: ['worktree', 'isolation', 'branch', 'sandbox', 'git', 'parallel'] },
  launchers: { owner: 'launchers', keys: ['launchFolderRoots'], keywords: ['launcher', 'deep link', 'argus://', 'url', 'link', 'run', 'jarvar', 'dashboard', 'approve', 'roots', 'template', 'templates', 'multi-session', 'spawn'] },
  confirmations: { owner: 'general', keys: ['confirmCloseShell', 'exitSessionsOnQuit', 'confirmExitOnQuit', 'confirmQuitDirectSessions'], keywords: ['confirm', 'ask', 'quit', 'cmd+q', 'close', 'cmd+w', 'exit', 'terminate', 'dialog', 'warning', 'direct'] },
  'auto-approval': { owner: 'auto-approval', keys: ['autoApprovalEnabled'], keywords: ['auto-approval', 'auto approve', 'approve', 'allow', 'permission', 'permissions', 'rules', 'hook', 'pretooluse', 'bash', 'prompt', 'audit'] },
  notifications: { owner: 'notifications', keys: ['notificationsEnabled', 'notifyOnWaiting', 'notifyOnDone', 'notifyOnPrChecks', 'notificationSound'], keywords: ['notification', 'notify', 'alert', 'sound', 'banner', 'desktop', 'waiting', 'done', 'badge', 'ci', 'checks', 'pull request'] },
  keyboard: { owner: 'keyboard', keys: ['keyboardShortcuts'], keywords: ['keyboard', 'shortcut', 'binding', 'hotkey', 'combo', 'accelerator', 'rebind'] },
  runtime: { owner: 'runtime', keys: ['ptyBackend', 'defaultTerminalEngine', 'defaultRunMode'], keywords: ['runtime', 'backend', 'argusd', 'daemon', 'tmux', 'pty', 'terminal engine', 'native', 'xterm', 'web', 'run mode', 'direct', 'persistent', 'default terminal', 'universal', 'advanced', 'orphan', 'duplicate', 'janitor', 'kill', 'leak', 'memory', 'maintenance'] },
  power: { owner: 'general', keys: ['preventSleepWhileRunning'], keywords: ['power', 'sleep', 'awake', 'caffeinate', 'idle', 'battery'] },
  remote: { owner: 'remote', keys: [], keywords: ['remote', 'ngrok', 'tunnel', 'mobile', 'phone', 'companion', 'qr', 'public url', 'password'] },
  developer: { owner: 'runtime', keys: ['debugToolsEnabled'], keywords: ['developer', 'debug', 'diagnostics', 'dump', 'devtools'] },
  beta: { owner: 'beta', keys: ['betaWorktreeLifecycle', 'betaActivityTimeline', 'betaSessionTemplates', 'betaHandoff', 'betaSessionChains'], keywords: ['beta', 'experimental', 'preview', 'labs', 'worktree', 'finish', 'stale', 'pull request', 'timeline', 'templates', 'handoff', 'chains', 'chain to', 'loop'] },
};

describe('consolidation keeps old search terms working', () => {
  it('covers all seventeen pre-merge panes', () => {
    expect(Object.keys(LEGACY_PANES).length).toBe(17);
  });

  for (const [oldId, { owner, keys, keywords }] of Object.entries(LEGACY_PANES)) {
    it(`"${oldId}" resolves to ${owner}, which owns its keys and matches every one of its keywords`, () => {
      expect(resolvePaneId(oldId)).toBe(owner);
      for (const key of keys) expect(PANES_BY_ID[owner].keys).toContain(key);
      const missed = keywords.filter((k) => !paneMatches(PANES_BY_ID[owner], k));
      expect(missed).toEqual([]);
    });
  }
});

describe('modified detection', () => {
  it('reports nothing modified for a default config', () => {
    expect(modifiedKeys(base()).size).toBe(0);
    expect(modifiedPanes(base()).size).toBe(0);
  });

  it('flags a changed scalar and the pane that owns it', () => {
    const config = { ...base(), uiFontSize: 18 };
    expect([...modifiedKeys(config)]).toEqual(['uiFontSize']);
    expect(modifiedPanes(config).has('theme')).toBe(true);
    expect(modifiedPanes(config).has('shell-header')).toBe(false);
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

  // The list used to be hand-maintained and drifted: nine pane-owned keys
  // (auto-approval, usage meter, PR status, inspector…) were counted by the
  // footer but never reset. Every pane key is resettable unless it is user data.
  it('resets every key a pane owns except user data', () => {
    const expected = PANES.flatMap((p) => p.keys).filter((k) => !USER_DATA_KEYS.includes(k));
    expect([...RESETTABLE_KEYS].sort()).toEqual([...expected].sort());
    expect(RESETTABLE_KEYS).toContain('autoApprovalEnabled');
    expect(RESETTABLE_KEYS).toContain('inspectorVisible');
    expect(RESETTABLE_KEYS).not.toContain('launchFolderRoots');
  });

  it('hands out clones, never the shared default objects', () => {
    const patch = resetPatch();
    expect(patch.keyboardShortcuts).not.toBe(DEFAULT_CONFIG.keyboardShortcuts);
  });
});
