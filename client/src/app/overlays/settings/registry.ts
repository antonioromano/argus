/**
 * The settings pane registry — the single source of truth for the sidebar.
 *
 * One pane per topic, grouped four ways. The old layout put eight unrelated
 * topics behind a single "General" tab and scattered the three confirmation
 * prefs across two others; every pane here owns one subject and fits a screen.
 *
 * `keys` is what makes the sidebar's modified dot and the footer count work: it
 * lists the AppConfig keys a pane edits, so the shell can diff live config
 * against DEFAULT_CONFIG without each pane reporting its own state upward.
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
  Type,
  PanelTop,
  Clock,
  Folders,
  ShieldAlert,
  Server,
  BatteryCharging,
  Wrench,
} from 'lucide-react';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';

export type PaneId =
  | 'theme'
  | 'typography'
  | 'shell-header'
  | 'toolbar'
  | 'agents'
  | 'groups'
  | 'isolation'
  | 'confirmations'
  | 'notifications'
  | 'keyboard'
  | 'runtime'
  | 'power'
  | 'remote'
  | 'developer';

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

export const PANES: readonly PaneDef[] = [
  {
    id: 'theme',
    label: 'Theme & motion',
    group: 'Appearance',
    icon: SlidersHorizontal,
    keys: ['mosaicOrientation', 'mosaicWaitingStyle'],
    keywords: ['theme', 'dark', 'light', 'system', 'appearance', 'waiting', 'attention', 'halo', 'breathing', 'pulse', 'flag', 'mosaic', 'layout', 'stacked', 'vertical', 'horizontal', 'side by side'],
  },
  {
    id: 'typography',
    label: 'Typography',
    group: 'Appearance',
    icon: Type,
    keys: ['codeFontSize', 'uiFontSize'],
    keywords: ['font', 'font size', 'text size', 'code font', 'interface font', 'terminal font', 'zoom', 'bigger', 'smaller'],
  },
  {
    id: 'shell-header',
    label: 'Shell header',
    group: 'Appearance',
    icon: PanelTop,
    keys: ['tileQuickAction', 'tileRunningIndicator'],
    keywords: ['quick action', 'tile', 'header', 'running indicator', 'hairline', 'progress', 'window controls'],
  },
  {
    id: 'toolbar',
    label: 'Toolbar',
    group: 'Appearance',
    icon: Clock,
    keys: ['showClock', 'clockShowSeconds'],
    keywords: ['clock', 'time', 'seconds', 'toolbar'],
  },
  {
    id: 'agents',
    label: 'Agents',
    group: 'Workspace',
    icon: Cpu,
    keys: ['defaultAgent', 'customAgents', 'agentFlags'],
    keywords: ['agent', 'claude', 'gemini', 'codex', 'custom agent', 'flags', 'cli', 'default agent', 'command'],
  },
  {
    id: 'groups',
    label: 'Groups',
    group: 'Workspace',
    icon: Folders,
    keys: ['othersFolderName'],
    keywords: ['group', 'folder', 'others', 'ungrouped', 'bucket', 'name'],
  },
  {
    id: 'isolation',
    label: 'Isolation',
    group: 'Workspace',
    icon: GitBranch,
    keys: [],
    keywords: ['worktree', 'isolation', 'branch', 'sandbox', 'git', 'parallel'],
  },
  {
    id: 'confirmations',
    label: 'Confirmations',
    group: 'Behavior',
    icon: ShieldAlert,
    keys: ['confirmCloseShell', 'exitSessionsOnQuit', 'confirmExitOnQuit'],
    keywords: ['confirm', 'ask', 'quit', 'cmd+q', 'close', 'cmd+w', 'exit', 'terminate', 'dialog', 'warning'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    group: 'Behavior',
    icon: Bell,
    keys: ['notificationsEnabled', 'notifyOnWaiting', 'notifyOnDone', 'notificationSound'],
    keywords: ['notification', 'notify', 'alert', 'sound', 'banner', 'desktop', 'waiting', 'done', 'badge'],
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    group: 'Behavior',
    icon: Keyboard,
    keys: ['keyboardShortcuts'],
    keywords: ['keyboard', 'shortcut', 'binding', 'hotkey', 'combo', 'accelerator', 'rebind'],
  },
  {
    id: 'runtime',
    label: 'Runtime',
    group: 'System',
    icon: Server,
    keys: ['ptyBackend', 'defaultTerminalEngine'],
    keywords: ['runtime', 'backend', 'argusd', 'daemon', 'tmux', 'pty', 'terminal engine', 'native', 'xterm', 'web'],
  },
  {
    id: 'power',
    label: 'Power',
    group: 'System',
    icon: BatteryCharging,
    keys: ['preventSleepWhileRunning'],
    keywords: ['power', 'sleep', 'awake', 'caffeinate', 'idle', 'battery'],
  },
  {
    id: 'remote',
    label: 'Remote access',
    group: 'System',
    icon: Wifi,
    keys: [],
    keywords: ['remote', 'ngrok', 'tunnel', 'mobile', 'phone', 'companion', 'qr', 'public url', 'password'],
  },
  {
    id: 'developer',
    label: 'Developer',
    group: 'System',
    icon: Wrench,
    keys: ['debugToolsEnabled'],
    keywords: ['developer', 'debug', 'diagnostics', 'dump', 'devtools'],
  },
];

export const PANES_BY_ID: Record<PaneId, PaneDef> = Object.fromEntries(
  PANES.map((p) => [p.id, p]),
) as Record<PaneId, PaneDef>;

/** Tab ids from before the re-cut. Deep links (`initialTab`) and any persisted
 *  value still resolve, so an old "open settings on Remote" call keeps working. */
const LEGACY_TAB_ALIASES: Record<string, PaneId> = {
  general: 'theme',
  agents: 'agents',
  notif: 'notifications',
  notifications: 'notifications',
  keyboard: 'keyboard',
  remote: 'remote',
  worktrees: 'isolation',
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

/** Deep-equal enough for config values: scalars, arrays of objects, and maps. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
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

/** What "Reset all" writes back.
 *
 *  Deliberately NOT every AppConfig key: customAgents and agentFlags are user
 *  data, not preferences — wiping them from a settings-wide reset would delete
 *  work, and removing an agent already has its own confirm. quickActionPromptedAt
 *  is bookkeeping (resetting it would re-show a one-time prompt). Both stay put.
 */
export const RESETTABLE_KEYS: ConfigKey[] = [
  'defaultAgent',
  'notificationsEnabled',
  'notifyOnWaiting',
  'notifyOnDone',
  'notificationSound',
  'showClock',
  'clockShowSeconds',
  'othersFolderName',
  'preventSleepWhileRunning',
  'confirmCloseShell',
  'exitSessionsOnQuit',
  'confirmExitOnQuit',
  'keyboardShortcuts',
  'uiFontSize',
  'codeFontSize',
  'mosaicWaitingStyle',
  'mosaicOrientation',
  'debugToolsEnabled',
  'ptyBackend',
  'tileQuickAction',
  'tileRunningIndicator',
  'defaultTerminalEngine',
];

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
