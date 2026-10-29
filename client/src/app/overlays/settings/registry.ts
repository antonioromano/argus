/**
 * The settings pane registry — the single source of truth for the sidebar.
 *
 * One pane per topic, grouped four ways. The old layout put eight unrelated
 * topics behind a single "General" tab and scattered the three confirmation
 * prefs across two others; every pane here owns one subject and fits a screen.
 *
 * `keys` is what makes the sidebar's modified dot and the footer count work: it
 * lists the AppConfig keys a pane edits, so the shell can diff live config
 * against DEFAULT_CONFIG without each pane reporting its own state upward. It is
 * derived from the per-setting catalog (catalog.ts), never hand-listed.
 * `keywords` feeds the filter box with the words a user would actually type
 * (control labels, old tab names, domain terms) rather than only the pane title.
 */
import {
  SlidersHorizontal,
  Cpu,
  Bell,
  Keyboard,
  Wifi,
  GitBranch,
  PanelTop,
  Server,
  Rocket,
  ShieldCheck,
  FlaskConical,
  Settings2,
} from 'lucide-react';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { SETTINGS, isSettingModified, paneConfigKeys, sameValue, type SettingDescriptor } from './catalog.js';

export type PaneId =
  | 'theme'
  | 'shell-header'
  | 'agents'
  | 'isolation'
  | 'launchers'
  | 'general'
  | 'auto-approval'
  | 'notifications'
  | 'keyboard'
  | 'runtime'
  | 'remote'
  | 'beta';

export type PaneGroup = 'Appearance' | 'Workspace' | 'Behavior' | 'System';

export const GROUP_ORDER: PaneGroup[] = ['Appearance', 'Workspace', 'Behavior', 'System'];

type ConfigKey = keyof AppConfig;

export interface PaneDef {
  id: PaneId;
  label: string;
  group: PaneGroup;
  icon: typeof Cpu;
  /** AppConfig keys this pane edits — drives the modified dot and footer count. */
  keys: ConfigKey[];
  /** Extra filter terms: control labels and the words users reach for. */
  keywords: string[];
}

/*
 * Twelve panes. 0.24 had seventeen, five of them holding one or two keys
 * (Typography, Toolbar, Groups, Power, Developer) plus Confirmations. Those were
 * folded into the pane whose subject they share; their keyword lists came with
 * them, so every word that used to find a setting still does (see the legacy
 * fixture in registry.test.ts), and their old ids are aliases below.
 */
const PANE_DEFS: readonly Omit<PaneDef, 'keys'>[] = [
  {
    id: 'theme',
    label: 'Theme & layout',
    group: 'Appearance',
    icon: SlidersHorizontal,
    keywords: [
      'theme', 'dark', 'light', 'system', 'appearance', 'waiting', 'attention', 'halo', 'breathing', 'pulse', 'flag', 'mosaic', 'layout', 'stacked', 'vertical', 'horizontal', 'side by side',
      // was Typography
      'typography', 'font', 'font size', 'text size', 'code font', 'interface font', 'terminal font', 'zoom', 'bigger', 'smaller',
      // was Toolbar
      'clock', 'time', 'seconds', 'toolbar',
      // plan 009
      'status bar', 'footer', 'connection', 'daemon',
      // plan 008
      'density', 'compact', 'comfortable', 'spacing', 'rows', 'dense',
    ],
  },
  {
    id: 'shell-header',
    label: 'Shell header',
    group: 'Appearance',
    icon: PanelTop,
    keywords: ['quick action', 'tile', 'header', 'running indicator', 'hairline', 'progress', 'window controls', 'usage', 'tokens', 'context', 'meter', 'plan usage', 'rate limit', 'limit', 'reset', 'model', 'warning', 'threshold', 'codex', 'pr', 'pull request', 'ci', 'checks', 'github', 'gh', 'inspector', 'session inspector', 'side panel', 'left', 'right', 'position', 'show', 'hide', 'git', 'branch'],
  },
  {
    id: 'agents',
    label: 'Agents',
    group: 'Workspace',
    icon: Cpu,
    keywords: ['agent', 'claude', 'gemini', 'codex', 'custom agent', 'flags', 'cli', 'default agent', 'command', 'renderer', 'fullscreen', 'classic', 'tui', 'duplicate', 'scrollback', 'chat', 'chat view', 'default view', 'terminal view'],
  },
  {
    id: 'isolation',
    label: 'Isolation',
    group: 'Workspace',
    icon: GitBranch,
    keywords: ['worktree', 'isolation', 'branch', 'sandbox', 'git', 'parallel'],
  },
  {
    id: 'launchers',
    label: 'Launchers',
    group: 'Workspace',
    icon: Rocket,
    keywords: ['launcher', 'deep link', 'argus://', 'url', 'link', 'run', 'jarvar', 'dashboard', 'approve', 'roots', 'template', 'templates', 'multi-session', 'spawn'],
  },
  {
    id: 'general',
    label: 'General',
    group: 'Behavior',
    icon: Settings2,
    keywords: [
      'general', 'behavior',
      // was Confirmations
      'confirmations', 'confirm', 'ask', 'quit', 'cmd+q', 'close', 'cmd+w', 'exit', 'terminate', 'dialog', 'warning', 'direct',
      // was Power
      'power', 'sleep', 'awake', 'caffeinate', 'idle', 'battery',
      // was Groups
      'groups', 'group', 'folder', 'others', 'ungrouped', 'bucket', 'name', 'naming',
      // plan 009
      'restore', 'reopen', 'launch', 'window', 'layout', 'remember',
    ],
  },
  {
    id: 'auto-approval',
    label: 'Auto-approval',
    group: 'Behavior',
    icon: ShieldCheck,
    keywords: ['auto-approval', 'auto approve', 'approve', 'allow', 'permission', 'permissions', 'rules', 'hook', 'pretooluse', 'bash', 'prompt', 'audit'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    group: 'Behavior',
    icon: Bell,
    keywords: ['notification', 'notify', 'alert', 'sound', 'banner', 'desktop', 'waiting', 'done', 'badge', 'ci', 'checks', 'pull request', 'tips', 'hints', 'onboarding', 'getting started', 'checklist'],
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    group: 'Behavior',
    icon: Keyboard,
    keywords: ['keyboard', 'shortcut', 'binding', 'hotkey', 'combo', 'accelerator', 'rebind'],
  },
  {
    id: 'runtime',
    label: 'Runtime',
    group: 'System',
    icon: Server,
    keywords: [
      'runtime', 'backend', 'argusd', 'daemon', 'tmux', 'pty', 'terminal engine', 'native', 'xterm', 'web', 'run mode', 'direct', 'persistent', 'default terminal', 'universal', 'advanced', 'orphan', 'duplicate', 'janitor', 'kill', 'leak', 'memory', 'maintenance',
      // was Developer
      'developer', 'debug', 'diagnostics', 'dump', 'devtools',
    ],
  },
  {
    id: 'remote',
    label: 'Remote access',
    group: 'System',
    icon: Wifi,
    keywords: ['remote', 'ngrok', 'tunnel', 'mobile', 'phone', 'companion', 'qr', 'public url', 'password'],
  },
  {
    id: 'beta',
    label: 'Beta features',
    group: 'System',
    icon: FlaskConical,
    keywords: ['beta', 'experimental', 'preview', 'labs', 'worktree', 'finish', 'stale', 'pull request', 'timeline', 'templates', 'handoff', 'chains', 'chain to', 'loop'],
  },
];

/** `keys` come from the catalog, so the pane a setting renders on and the pane
 *  credited with it (modified dot, footer count, Reset all) are the same fact. */
export const PANES: readonly PaneDef[] = PANE_DEFS.map((p) => ({ ...p, keys: paneConfigKeys(p.id) }));

export const PANES_BY_ID: Record<PaneId, PaneDef> = Object.fromEntries(
  PANES.map((p) => [p.id, p]),
) as Record<PaneId, PaneDef>;

/** Ids that no longer name a pane: tabs from before the 0.24 re-cut, and the
 *  panes merged away since. Deep links (`initialTab`) and any persisted value
 *  still resolve, so an old "open settings on Typography" call keeps working.
 *  The pre-0.24 `general` tab is now the real General pane, so it needs none. */
const LEGACY_TAB_ALIASES: Record<string, PaneId> = {
  notif: 'notifications',
  worktrees: 'isolation',
  typography: 'theme',
  toolbar: 'theme',
  confirmations: 'general',
  power: 'general',
  groups: 'general',
  developer: 'runtime',
};

export function resolvePaneId(raw: string | undefined): PaneId {
  if (!raw) return 'theme';
  if (raw in PANES_BY_ID) return raw as PaneId;
  return LEGACY_TAB_ALIASES[raw] ?? 'theme';
}

/** Substring match over the pane title plus its keyword list. */
export function paneMatches(pane: PaneDef, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (pane.label.toLowerCase().includes(q)) return true;
  if (pane.group.toLowerCase().includes(q)) return true;
  return pane.keywords.some((k) => k.includes(q));
}

/** Config keys whose value differs from the shipped default. A key absent from
 *  config counts as default — the server merges DEFAULT_CONFIG underneath. */
export function modifiedKeys(config: AppConfig): Set<ConfigKey> {
  const out = new Set<ConfigKey>();
  for (const pane of PANES) {
    for (const key of pane.keys) {
      const live = config[key];
      if (live === undefined) continue;
      if (!sameValue(live, DEFAULT_CONFIG[key])) out.add(key);
    }
  }
  return out;
}

/** Panes holding at least one non-default value — the sidebar's amber dot. */
export function modifiedPanes(config: AppConfig): Set<PaneId> {
  const keys = modifiedKeys(config);
  const out = new Set<PaneId>();
  for (const pane of PANES) {
    if (pane.keys.some((k) => keys.has(k))) out.add(pane.id);
  }
  return out;
}

/** Pane-owned keys that hold user data, not preferences: agents the user
 *  defined, the flags attached to them, and the folders launchers may open.
 *  Wiping them from a settings-wide reset would delete work (removing an agent
 *  already has its own confirm), so "Reset all" leaves them alone.
 */
export const USER_DATA_KEYS: readonly ConfigKey[] = ['customAgents', 'agentFlags', 'launchFolderRoots'];

/** What "Reset all" writes back: every key a pane owns, minus user data.
 *
 *  Derived rather than hand-listed — the hand-kept list drifted and skipped
 *  keys the footer counted as changed. Bookkeeping (introSeen,
 *  quickActionPromptedAt, inspector layout) is owned by no pane, so it is never
 *  reset either.
 */
export const RESETTABLE_KEYS: ConfigKey[] = PANES
  .flatMap((p) => p.keys)
  .filter((k) => !USER_DATA_KEYS.includes(k));

export function resetPatch(): Partial<AppConfig> {
  const patch: Partial<AppConfig> = {};
  for (const key of RESETTABLE_KEYS) {
    // Structured values are cloned so the shared default object is never handed
    // out by reference and mutated downstream.
    const value = DEFAULT_CONFIG[key];
    (patch as Record<string, unknown>)[key] =
      typeof value === 'object' && value !== null ? structuredClone(value) : value;
  }
  return patch;
}

/** A fresh copy of a key's shipped default, never the shared object itself. */
function defaultValue(key: ConfigKey): unknown {
  const value = DEFAULT_CONFIG[key];
  return typeof value === 'object' && value !== null ? structuredClone(value) : value;
}

/** The agents the user defined and their flags: data, never "a modified setting". */
const AGENT_DATA_KEYS: readonly ConfigKey[] = ['customAgents', 'agentFlags'];

/** Settings shown in the Modified view: every descriptor that differs from its
 *  default, in catalog order. Custom agents and their flags are not listed.
 *  Folder roots are, because a single-row reset there is explicit and undoable. */
export function modifiedSettings(config: AppConfig): SettingDescriptor[] {
  return SETTINGS.filter((s) => !s.keys.some((k) => AGENT_DATA_KEYS.includes(k)) && isSettingModified(s, config));
}

/** What resetting one setting writes. A shortcut row shares the
 *  keyboardShortcuts map with every other binding, so it drops only its own
 *  override; anything else gets its keys' defaults. */
export function settingResetPatch(s: SettingDescriptor, config: AppConfig): Partial<AppConfig> {
  if (s.id.startsWith('shortcut:')) {
    const next = { ...(config.keyboardShortcuts ?? {}) };
    delete next[s.id.slice('shortcut:'.length)];
    return { keyboardShortcuts: next };
  }
  const patch: Partial<AppConfig> = {};
  for (const key of s.keys) (patch as Record<string, unknown>)[key] = defaultValue(key);
  return patch;
}

/** Keys a pane's Reset writes: its preferences that differ from the default.
 *  User data stays, as with Reset all — the Agents pane resets its three
 *  preferences and never touches the agents themselves. */
export function paneResetKeys(pane: PaneId, config: AppConfig): ConfigKey[] {
  const keys = modifiedKeys(config);
  return PANES_BY_ID[pane].keys.filter((k) => !USER_DATA_KEYS.includes(k) && keys.has(k));
}

export function paneResetPatch(pane: PaneId, config: AppConfig): Partial<AppConfig> {
  const patch: Partial<AppConfig> = {};
  for (const key of paneResetKeys(pane, config)) (patch as Record<string, unknown>)[key] = defaultValue(key);
  return patch;
}
