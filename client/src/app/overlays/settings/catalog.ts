/**
 * The settings catalog — one descriptor per control, declared once.
 *
 * Every row a pane renders goes through `SettingField`, which looks its label
 * and hint up here, so the strings exist in exactly one place. The filter box
 * (control-level search), the registry's per-pane `keys` (modified dot, footer
 * count, Reset all) and the command palette (plan 001) all read this list, so
 * none of them can drift from what is on screen. `catalog.sync.test.tsx` fails
 * when a rendered row has no descriptor or a descriptor has no row.
 *
 * Copy edits (plan 005) happen here, not in the panes.
 */
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import type { PaneId } from './registry.js';
import { SHORTCUTS } from '../../../keyboard/registry.js';
import { BETA_FEATURES } from '../../../utils/betaFlags.js';
import { KIND_LABEL, kindOf } from '../../ui/terminalKind.js';
import {
  BACKEND_OPTIONS,
  CODE_FONT_PRESETS,
  DENSITY_OPTIONS,
  INDICATOR_OPTIONS,
  INSPECTOR_SIDE_OPTIONS,
  LAYOUT_OPTIONS,
  RENDERER_HINT,
  RENDERER_OPTIONS,
  THEME_OPTIONS,
  UI_FONT_PRESETS,
  VIEW_OPTIONS,
  WAITING_OPTIONS,
} from './options.js';

type ConfigKey = keyof AppConfig;

export interface SettingDescriptor {
  /** Stable. The config key when there is one ('showClock'), else a namespaced
   *  id ('shortcut:new-session', 'beta:betaHandoff', 'device:themeMode'). */
  id: string;
  pane: PaneId;
  /** Title of the Section the row renders under. */
  section: string;
  /** Rendered verbatim by SettingField. */
  label: string;
  hint?: string | ((c: AppConfig) => string);
  keywords?: readonly string[];
  /** Config keys the control writes; [] for device-local settings. */
  keys: ConfigKey[];
  kind: 'toggle' | 'choice' | 'number' | 'text' | 'list' | 'custom';
  /** Value labels for a 'choice' (search, Modified view, palette). */
  options?: readonly { value: string; label: string }[];
  /** False hides the row (e.g. seconds while the clock is off). */
  visibleWhen?: (c: AppConfig) => boolean;
  /** Setting to jump to instead while this one is hidden — its parent toggle. */
  revealVia?: string;
  /** Current-value label, when the kind's default rendering is not enough. */
  format?: (c: AppConfig) => string;
  /** Whether this setting differs from its default, when "any key differs" is
   *  too coarse (one shortcut inside the shared keyboardShortcuts map). */
  modified?: (c: AppConfig) => boolean;
  /**
   * Plan 001's palette contract. 'toggle': flip in place, only for a plain
   * reversible boolean with no confirm. 'open' (default): list it and open
   * Settings at it via focusSetting. 'none': keep it out of the palette.
   */
  palette?: 'toggle' | 'open' | 'none';
  /** 'device' = stored in this browser (localStorage), not in AppConfig — never
   *  counted as modified, never reset. Default 'config'. */
  source?: 'config' | 'device';
}

const ON_OFF = (v: unknown) => (v ? 'On' : 'Off');

const BASE: readonly SettingDescriptor[] = [
  // ── Theme & layout ────────────────────────────────────────────────────────
  {
    id: 'device:themeMode', pane: 'theme', section: 'Theme',
    label: 'Appearance', hint: 'Match the system or pick a fixed appearance',
    keywords: ['theme', 'dark', 'light', 'system', 'dark mode', 'light mode'],
    keys: [], kind: 'choice', options: THEME_OPTIONS, source: 'device',
  },
  {
    id: 'density', pane: 'theme', section: 'Density',
    label: 'Density', hint: 'Row height, header padding and toolbar height. Text and terminal sizes do not change',
    keywords: ['density', 'compact', 'comfortable', 'spacing', 'rows', 'row height', 'dense', 'padding', 'toolbar height'],
    keys: ['density'], kind: 'choice', options: DENSITY_OPTIONS,
  },
  {
    id: 'codeFontSize', pane: 'theme', section: 'Font sizes',
    label: 'Code', hint: 'Session terminals, file viewer, and diffs · default Medium',
    keywords: ['font', 'font size', 'code font', 'terminal font', 'text size', 'zoom', 'bigger', 'smaller', 'typography'],
    keys: ['codeFontSize'], kind: 'choice', options: CODE_FONT_PRESETS,
  },
  {
    id: 'uiFontSize', pane: 'theme', section: 'Font sizes',
    label: 'Interface', hint: 'Menus, panels, labels, and the rest of the app · default Medium',
    keywords: ['font', 'font size', 'interface font', 'text size', 'zoom', 'bigger', 'smaller', 'typography'],
    keys: ['uiFontSize'], kind: 'choice', options: UI_FONT_PRESETS,
  },
  {
    id: 'mosaicOrientation', pane: 'theme', section: 'Session layout',
    label: 'Arrangement', hint: 'Arrange mosaic sessions side by side or stacked one under another',
    keywords: ['mosaic', 'layout', 'stacked', 'vertical', 'horizontal', 'side by side'],
    keys: ['mosaicOrientation'], kind: 'choice', options: LAYOUT_OPTIONS,
  },
  {
    id: 'mosaicWaitingStyle', pane: 'theme', section: 'Waiting attention',
    label: 'Style', hint: 'How a session waiting for input stands out in the mosaic',
    keywords: ['waiting', 'attention', 'halo', 'breathing', 'pulse', 'flag'],
    keys: ['mosaicWaitingStyle'], kind: 'choice', options: WAITING_OPTIONS,
  },
  {
    id: 'showStatusBar', pane: 'theme', section: 'Status bar',
    label: 'Show status bar',
    hint: 'A thin bar along the bottom with connection, session counts, remote access, keep-awake, updates and the clock. When off, the update notice moves to the toolbar.',
    keywords: ['status bar', 'footer', 'bottom', 'connection', 'daemon', 'health', 'indicators'],
    keys: ['showStatusBar'], kind: 'toggle', palette: 'toggle',
  },
  {
    id: 'showClock', pane: 'theme', section: 'Status bar',
    label: 'Show clock in status bar', hint: 'Displays the current time (HH:MM) at the right of the status bar',
    keywords: ['clock', 'time', 'toolbar'],
    keys: ['showClock'], kind: 'toggle', palette: 'toggle',
  },
  {
    id: 'clockShowSeconds', pane: 'theme', section: 'Status bar',
    label: 'Show seconds', hint: 'Extends the clock to HH:MM:SS',
    keywords: ['clock', 'time', 'seconds'],
    keys: ['clockShowSeconds'], kind: 'toggle', palette: 'toggle',
    visibleWhen: (c) => c.showClock ?? false, revealVia: 'showClock',
  },

  // ── Shell header ──────────────────────────────────────────────────────────
  {
    id: 'tileQuickAction', pane: 'shell-header', section: 'Header content',
    label: 'Quick action',
    hint: 'One action pinned beside the window controls in every session header. Everything else stays in the ⋯ menu.',
    keywords: ['quick action', 'tile', 'header', 'pinned'],
    keys: ['tileQuickAction'], kind: 'custom',
  },
  {
    id: 'tileRunningIndicator', pane: 'shell-header', section: 'Header content',
    label: 'Running indicator', hint: '2px progress hairline under the header while an agent is working',
    keywords: ['hairline', 'progress', 'running'],
    keys: ['tileRunningIndicator'], kind: 'choice', options: INDICATOR_OPTIONS,
  },
  {
    id: 'showUsageMeter', pane: 'shell-header', section: 'Header content',
    label: 'Usage meter', hint: 'Context and plan usage on Claude and Codex sessions. Gemini doesn’t report usage',
    keywords: ['usage', 'tokens', 'context', 'meter', 'plan usage', 'rate limit', 'show', 'hide'],
    keys: ['showUsageMeter'], kind: 'toggle', palette: 'toggle',
  },
  {
    id: 'usageMeterParts', pane: 'shell-header', section: 'Header content',
    label: 'Show', hint: 'Drag to reorder · click to hide. Plan usage is per account, the same in every session',
    keywords: ['usage meter parts', 'tokens', 'model', 'context', 'reorder'],
    keys: ['usageMeterParts'], kind: 'list',
  },
  {
    id: 'usageWarnContext', pane: 'shell-header', section: 'Header content',
    label: 'Context warning', hint: 'Chip turns amber, then red, as a session’s context fills',
    keywords: ['threshold', 'amber', 'red', 'warning', 'context'],
    keys: ['usageWarnContext'], kind: 'custom',
    format: (c) => { const t = c.usageWarnContext ?? DEFAULT_CONFIG.usageWarnContext!; return `${t.amber}% / ${t.red}%`; },
  },
  {
    id: 'usageWarnPlan', pane: 'shell-header', section: 'Header content',
    label: 'Plan usage warning', hint: 'Amber, then red, as you near your plan’s limit',
    keywords: ['threshold', 'amber', 'red', 'warning', 'limit', 'rate limit'],
    keys: ['usageWarnPlan'], kind: 'custom',
    format: (c) => { const t = c.usageWarnPlan ?? DEFAULT_CONFIG.usageWarnPlan!; return `${t.amber}% / ${t.red}%`; },
  },
  {
    id: 'showPrStatus', pane: 'shell-header', section: 'Header content',
    label: 'Pull request status',
    hint: 'PR number, state and CI checks for sessions on a branch with a GitHub PR. Needs the gh CLI, logged in',
    keywords: ['pr', 'pull request', 'ci', 'checks', 'github', 'gh'],
    keys: ['showPrStatus'], kind: 'toggle', palette: 'toggle',
  },
  {
    id: 'inspectorVisible', pane: 'shell-header', section: 'Session Inspector',
    label: 'Show Session Inspector', hint: 'Hidden, the session header shows usage, git and pull request as chips again. ⌘I toggles it',
    keywords: ['inspector', 'session inspector', 'side panel', 'hide'],
    keys: ['inspectorVisible'], kind: 'toggle', palette: 'toggle',
  },
  {
    id: 'inspectorSide', pane: 'shell-header', section: 'Session Inspector',
    label: 'Position',
    hint: 'Usage, git and pull request of the open session (or the selected tile). Left: in the sidebar, between Sessions and System. Right: a column beside the sessions. While the sidebar holding it is collapsed, the header shows them as chips',
    keywords: ['inspector', 'session inspector', 'side panel', 'left', 'right', 'side'],
    keys: ['inspectorSide'], kind: 'choice', options: INSPECTOR_SIDE_OPTIONS,
  },

  // ── Agents ────────────────────────────────────────────────────────────────
  {
    id: 'defaultAgent', pane: 'agents', section: 'Default for new sessions',
    label: 'Default agent', keywords: ['default agent', 'new session', 'claude', 'gemini', 'codex'],
    keys: ['defaultAgent'], kind: 'text',
  },
  {
    id: 'claudeRenderer', pane: 'agents', section: 'Claude display',
    label: 'Renderer',
    hint: (c) => `${RENDERER_HINT[c.claudeRenderer ?? 'fullscreen']} Applies to new and restarted sessions.`,
    keywords: ['renderer', 'fullscreen', 'classic', 'tui', 'duplicate', 'scrollback'],
    keys: ['claudeRenderer'], kind: 'choice', options: RENDERER_OPTIONS,
  },
  {
    id: 'defaultSessionView', pane: 'agents', section: 'Claude display',
    label: 'Default view',
    hint: 'Where a Claude session opens until you pick a view for it with its Terminal/Chat toggle. Other agents always use the terminal.',
    keywords: ['chat', 'chat view', 'default view', 'terminal view'],
    keys: ['defaultSessionView'], kind: 'choice', options: VIEW_OPTIONS,
  },
  {
    id: 'customAgents', pane: 'agents', section: 'Installed agents',
    label: 'Installed agents', hint: 'Custom agents and the flags each agent starts with',
    keywords: ['custom agent', 'add agent', 'flags', 'cli', 'command'],
    keys: ['customAgents', 'agentFlags'], kind: 'list',
    format: (c) => `${c.customAgents.length} custom`,
  },

  // ── Launchers ─────────────────────────────────────────────────────────────
  {
    id: 'launchFolderRoots', pane: 'launchers', section: 'Launch links',
    label: 'Folder roots',
    hint: 'One per line. Links to folders outside these get a warning on the approval card (never blocked).',
    keywords: ['roots', 'deep link', 'argus://', 'folder'],
    keys: ['launchFolderRoots'], kind: 'list',
    format: (c) => (c.launchFolderRoots ?? []).join(', '),
  },
  {
    id: 'mcpServerEnabled', pane: 'launchers', section: 'Argus MCP server',
    label: 'Let Claude sessions orchestrate Argus',
    hint: 'New and restarted Claude sessions get an argus MCP server: start sessions (each one opens an approval card), list and read sessions, and send input to or interrupt the ones they started. Running sessions pick it up on restart.',
    keywords: ['mcp', 'orchestrator', 'orchestrate', 'start_session', 'mcp server'],
    // It hands sessions control over Argus: open it in Settings, never flip it from the palette.
    keys: ['mcpServerEnabled'], kind: 'toggle', palette: 'open',
  },

  // ── General ───────────────────────────────────────────────────────────────
  {
    id: 'confirmCloseShell', pane: 'general', section: 'Ask before',
    label: 'Closing a running session', hint: 'Ask before closing a session whose agent is still running. When off, sessions close right away; Claude sessions can be reopened from the toast.',
    keywords: ['confirm', 'close', 'cmd+w', 'dialog'],
    keys: ['confirmCloseShell'], kind: 'toggle',
  },
  {
    id: 'exitSessionsOnQuit', pane: 'general', section: 'When quitting',
    label: 'Stop all sessions when quitting',
    hint: 'When off, ⌘Q keeps sessions running in the background. When on, ⌘Q stops every session.',
    keywords: ['quit', 'cmd+q', 'exit', 'terminate', 'background'],
    keys: ['exitSessionsOnQuit'], kind: 'toggle',
  },
  {
    id: 'confirmQuitDirectSessions', pane: 'general', section: 'When quitting',
    label: 'Ask before quitting stops running sessions',
    hint: 'Sessions using the Native terminal stop when Argus quits. Ask first if any are still running.',
    keywords: ['confirm', 'quit', 'native', 'direct'],
    keys: ['confirmQuitDirectSessions'], kind: 'toggle',
    visibleWhen: (c) => !(c.exitSessionsOnQuit ?? false), revealVia: 'exitSessionsOnQuit',
  },
  {
    id: 'confirmExitOnQuit', pane: 'general', section: 'When quitting',
    label: 'Ask before stopping sessions',
    hint: 'List the running sessions and ask before ⌘Q stops them',
    keywords: ['confirm', 'quit', 'exit', 'dialog'],
    keys: ['confirmExitOnQuit'], kind: 'toggle',
    visibleWhen: (c) => c.exitSessionsOnQuit ?? false, revealVia: 'exitSessionsOnQuit',
  },
  {
    id: 'preventSleepWhileRunning', pane: 'general', section: 'Sleep',
    label: 'Keep Mac awake while running', hint: 'Prevents macOS from sleeping while at least one session is running',
    keywords: ['power', 'sleep', 'awake', 'caffeinate', 'idle', 'battery'],
    keys: ['preventSleepWhileRunning'], kind: 'toggle', palette: 'toggle',
  },
  {
    id: 'othersFolderName', pane: 'general', section: 'Naming',
    label: '"Others" folder name', hint: 'Display name for the group of ungrouped sessions',
    keywords: ['group', 'folder', 'others', 'ungrouped', 'bucket', 'name'],
    keys: ['othersFolderName'], kind: 'text',
  },
  {
    id: 'restoreLayoutOnLaunch', pane: 'general', section: 'Windows',
    label: 'Restore layout on launch',
    hint: 'Reopen each window on the session, side panel and group filter it showed when Argus quit. When off, windows open on the mosaic.',
    keywords: ['restore', 'reopen', 'launch', 'relaunch', 'window', 'layout', 'remember', 'state'],
    keys: ['restoreLayoutOnLaunch'], kind: 'toggle',
  },

  // ── Auto-approval ─────────────────────────────────────────────────────────
  {
    id: 'autoApprovalEnabled', pane: 'auto-approval', section: 'Auto-approval',
    label: 'Auto-approve matching tool calls',
    hint: 'Claude sessions only. A rule can only allow; anything it does not match still asks, and your own Claude deny and ask rules still apply.',
    keywords: ['auto approve', 'permission', 'rules', 'allow'],
    keys: ['autoApprovalEnabled'], kind: 'toggle',
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  {
    id: 'notificationsEnabled', pane: 'notifications', section: 'Delivery',
    label: 'Native desktop notifications', hint: 'Fire only while Argus is in the background',
    keywords: ['notification', 'notify', 'desktop', 'banner', 'alert'],
    keys: ['notificationsEnabled'], kind: 'toggle',
  },
  {
    id: 'notifyOnWaiting', pane: 'notifications', section: 'When to notify',
    label: 'A session needs your input', keywords: ['waiting', 'input', 'notify'],
    keys: ['notifyOnWaiting'], kind: 'toggle', palette: 'toggle',
  },
  {
    id: 'notifyOnDone', pane: 'notifications', section: 'When to notify',
    label: 'A session finishes a run', keywords: ['done', 'finished', 'notify'],
    keys: ['notifyOnDone'], kind: 'toggle', palette: 'toggle',
  },
  {
    id: 'notifyOnPrChecks', pane: 'notifications', section: 'When to notify',
    label: "A pull request's checks finish", hint: 'Passed or failed, for the PR shown in a session\'s header',
    keywords: ['ci', 'checks', 'pull request', 'pr', 'notify'],
    keys: ['notifyOnPrChecks'], kind: 'toggle', palette: 'toggle',
  },
  {
    id: 'notificationSound', pane: 'notifications', section: 'When to notify',
    label: 'Play a sound', hint: 'Plays the default system sound with each notification',
    keywords: ['sound', 'audio', 'notify'],
    keys: ['notificationSound'], kind: 'toggle', palette: 'toggle',
  },
  {
    id: 'showTips', pane: 'notifications', section: 'In-app tips',
    label: 'Show tips', hint: 'A short hint the first time a feature would help — at most one an hour',
    keywords: ['tips', 'hints', 'onboarding', 'getting started', 'checklist', 'discovery'],
    keys: ['showTips'], kind: 'toggle', palette: 'toggle',
  },

  // ── Runtime ───────────────────────────────────────────────────────────────
  {
    id: 'ptyBackend', pane: 'runtime', section: 'Session host',
    label: 'Session host', hint: 'Keeps sessions running after you quit Argus.',
    keywords: ['backend', 'argusd', 'daemon', 'tmux', 'pty'],
    keys: ['ptyBackend'], kind: 'choice', options: BACKEND_OPTIONS,
  },
  {
    id: 'defaultTerminal', pane: 'runtime', section: 'Default terminal',
    label: 'Default terminal',
    hint: 'Applies to new sessions only — existing ones keep the terminal they were created with.',
    keywords: ['terminal engine', 'native', 'xterm', 'web', 'run mode', 'direct', 'persistent', 'universal', 'advanced'],
    keys: ['defaultRunMode', 'defaultTerminalEngine'], kind: 'custom',
    format: (c) => KIND_LABEL[kindOf(c.defaultRunMode, c.defaultTerminalEngine)],
  },
  {
    id: 'debugToolsEnabled', pane: 'runtime', section: 'Diagnostics',
    label: 'Enable developer tools',
    hint: 'Adds a per-session diagnostics dump button (writes session state + output to ~/.argus/diagnostics for debugging)',
    keywords: ['developer', 'debug', 'diagnostics', 'dump', 'devtools'],
    keys: ['debugToolsEnabled'], kind: 'toggle', palette: 'toggle',
  },
];

/** One row per shortcut, generated so the keyboard registry stays the source of its copy. */
const SHORTCUT_SETTINGS: readonly SettingDescriptor[] = SHORTCUTS.map((s) => ({
  id: `shortcut:${s.id}`,
  pane: 'keyboard' as const,
  section: s.category,
  label: s.label,
  hint: s.note,
  keywords: ['shortcut', 'keyboard', 'binding', 'hotkey'],
  keys: ['keyboardShortcuts'],
  kind: 'custom' as const,
  modified: (c: AppConfig) => !s.fixed && c.keyboardShortcuts?.[s.id] !== undefined,
  format: (c: AppConfig) => c.keyboardShortcuts?.[s.id] ?? s.defaultCombo,
}));

/** One row per beta flag, generated from BETA_FEATURES for the same reason. */
const BETA_SETTINGS: readonly SettingDescriptor[] = BETA_FEATURES.map((f) => ({
  id: `beta:${f.flag}`,
  pane: 'beta' as const,
  section: 'Beta features',
  label: f.label,
  hint: f.description,
  keywords: ['beta', 'experimental', 'labs'],
  keys: [f.flag],
  kind: 'toggle' as const,
  palette: 'toggle' as const,
}));

export const SETTINGS: readonly SettingDescriptor[] = [...BASE, ...SHORTCUT_SETTINGS, ...BETA_SETTINGS];

export const SETTINGS_BY_ID: Readonly<Record<string, SettingDescriptor>> = Object.fromEntries(
  SETTINGS.map((s) => [s.id, s]),
);

/** Deep-equal enough for config values: scalars, arrays of objects, and maps. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** Config keys of a pane, in catalog order — what the registry's `keys` are. */
export function paneConfigKeys(pane: PaneId): ConfigKey[] {
  const out: ConfigKey[] = [];
  for (const s of SETTINGS) {
    if (s.pane !== pane || s.source === 'device') continue;
    for (const k of s.keys) if (!out.includes(k)) out.push(k);
  }
  return out;
}

export function isSettingVisible(s: SettingDescriptor, config: AppConfig): boolean {
  return s.visibleWhen ? s.visibleWhen(config) : true;
}

export function settingHint(s: SettingDescriptor, config: AppConfig = DEFAULT_CONFIG): string | undefined {
  return typeof s.hint === 'function' ? s.hint(config) : s.hint;
}

/** Live value of a key, the shipped default when the config does not carry it. */
function valueOf(config: AppConfig, key: ConfigKey): unknown {
  return config[key] ?? DEFAULT_CONFIG[key];
}

/** Human label for a setting's current value (Modified view, palette hints). */
export function settingValueLabel(s: SettingDescriptor, config: AppConfig): string {
  if (s.format) return s.format(config);
  if (s.keys.length === 0) return '';
  const v = valueOf(config, s.keys[0]);
  switch (s.kind) {
    case 'toggle':
      return ON_OFF(v);
    case 'choice':
      return s.options?.find((o) => o.value === String(v))?.label ?? String(v);
    case 'number':
    case 'text':
      return String(v ?? '');
    default:
      return sameValue(config[s.keys[0]], DEFAULT_CONFIG[s.keys[0]]) ? 'Default' : 'Custom';
  }
}

/** Whether the setting differs from its default. A key absent from config counts
 *  as default (the server merges DEFAULT_CONFIG underneath); device settings
 *  are never "modified" because they are not part of the config. */
export function isSettingModified(s: SettingDescriptor, config: AppConfig): boolean {
  if (s.source === 'device') return false;
  if (s.modified) return s.modified(config);
  return s.keys.some((k) => config[k] !== undefined && !sameValue(config[k], DEFAULT_CONFIG[k]));
}
