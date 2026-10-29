import { Router } from 'express';
import type { ConfigStore } from '../persistence/ConfigStore.js';
import type { AgentRegistry } from '../services/AgentRegistry.js';
import type { AgentDefinition, AgentFlag, AppConfig, DiscoveryState, TileQuickAction } from '@argus/shared';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isUsageMeterParts, isWarnThresholds } from '../utils/usageMeter.js';
import { INSPECTOR_WIDTH_MIN, INSPECTOR_WIDTH_MAX, INSPECTOR_SECTION_ID, INSPECTOR_SECTIONS_MAX } from '../constants/inspector.js';
import { SHELL_AGENT_ID } from '../constants/agents.js';

const TILE_QUICK_ACTIONS: readonly TileQuickAction[] = ['diff', 'files', 'shell', 'clone', 'restart', 'done', 'apply', 'none'];

function isTileQuickAction(v: unknown): v is TileQuickAction {
  return typeof v === 'string' && (TILE_QUICK_ACTIONS as readonly string[]).includes(v);
}

// Validate flag values stored in agentFlags config to prevent shell injection.
// The settings import preview keeps copies of FLAG_PATTERN and COMMAND_PATTERN
// (client/src/settings-backup/parseSettingsFile.ts); check-dep-sync pins them.
const FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9\-_.=:,/ ]*$/;
// Custom agent commands are spawned via the shell — restrict to safe characters
// (binary name + simple args), rejecting shell metacharacters.
const COMMAND_PATTERN = /^[a-zA-Z0-9_@./\- ]+$/;

function isStringRecord(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}

function isInspectorSectionList(v: unknown): v is string[] {
  return Array.isArray(v)
    && v.length <= INSPECTOR_SECTIONS_MAX
    && v.every((id) => typeof id === 'string' && INSPECTOR_SECTION_ID.test(id));
}

const DISCOVERY_LIST_MAX = 64;
const DISCOVERY_ID_MAX = 64;
const EMPTY_DISCOVERY: DiscoveryState = {
  tipsSeen: [], tipLastShownAt: 0, notifAskedAt: 0, used: [],
  checklistStartedAt: 0, checklistDone: [], checklistDismissed: false, betaPromosHidden: [],
};

/**
 * Discovery bookkeeping is written whole by the client, but it is still input:
 * lists are capped (64 ids of ≤ 64 chars), timestamps must be finite and
 * non-negative, and unknown fields are dropped. A bad field keeps its current
 * value rather than failing the whole PUT — this is bookkeeping, not a setting.
 */
export function sanitizeDiscovery(v: unknown, current: DiscoveryState | undefined): DiscoveryState {
  const base: DiscoveryState = { ...EMPTY_DISCOVERY, ...(current ?? {}) };
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return base;
  const raw = v as Record<string, unknown>;
  const list = (key: keyof DiscoveryState): string[] => {
    const x = raw[key];
    if (!Array.isArray(x)) return base[key] as string[];
    return x.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= DISCOVERY_ID_MAX)
      .slice(0, DISCOVERY_LIST_MAX);
  };
  const time = (key: keyof DiscoveryState): number => {
    const x = raw[key];
    return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : base[key] as number;
  };
  return {
    tipsSeen: list('tipsSeen'),
    tipLastShownAt: time('tipLastShownAt'),
    notifAskedAt: time('notifAskedAt'),
    used: list('used'),
    checklistStartedAt: time('checklistStartedAt'),
    checklistDone: list('checklistDone'),
    checklistDismissed: typeof raw.checklistDismissed === 'boolean' ? raw.checklistDismissed : base.checklistDismissed,
    betaPromosHidden: list('betaPromosHidden'),
  };
}

function validateAgentFlags(agentFlags: unknown): string | null {
  if (typeof agentFlags !== 'object' || agentFlags === null || Array.isArray(agentFlags)) {
    return 'agentFlags must be an object of agent ids to flag lists.';
  }
  for (const flags of Object.values(agentFlags as Record<string, unknown>)) {
    if (!Array.isArray(flags)) return 'Each agent\'s flags must be a list.';
    for (const flag of flags as Partial<AgentFlag>[]) {
      // Type-guard every field before use: settings import sends untrusted
      // JSON here, and a non-string must be a 400, never a crash.
      if (typeof flag !== 'object' || flag === null) return 'Each flag must be an object.';
      if (typeof flag.id !== 'string') return 'Each flag needs a string id.';
      if (typeof flag.value !== 'string') return 'Each flag needs a string value.';
      if (flag.enabled !== undefined && typeof flag.enabled !== 'boolean') return 'A flag\'s enabled must be true or false.';
      if (!FLAG_PATTERN.test(flag.value.trim())) {
        return `Invalid flag value: "${flag.value}". Flags must start with - or -- and contain only safe characters.`;
      }
    }
  }
  return null;
}

/** Built-in agent ids. AgentRegistry.getById finds the built-in first, so a
 *  custom agent reusing one would be silently shadowed (and its command never run). */
const BUILTIN_AGENT_IDS: readonly string[] = ['claude', 'gemini', 'codex', SHELL_AGENT_ID];

function validateCustomAgents(customAgents: unknown): string | null {
  if (!Array.isArray(customAgents)) return 'customAgents must be a list.';
  const ids = new Set<string>();
  for (const a of customAgents as Partial<AgentDefinition>[]) {
    if (typeof a !== 'object' || a === null) return 'Each custom agent must be an object.';
    if (!a.id || typeof a.id !== 'string') return 'Each custom agent needs an id.';
    if (BUILTIN_AGENT_IDS.includes(a.id)) return `Custom agent id "${a.id}" is reserved for a built-in agent.`;
    if (ids.has(a.id)) return `Custom agent id "${a.id}" is used twice.`;
    ids.add(a.id);
    if (typeof a.name !== 'string' || !a.name.trim()) return 'Each custom agent needs a name.';
    if (typeof a.command !== 'string' || !a.command.trim()) return `Agent "${a.name}" needs a command.`;
    if (!COMMAND_PATTERN.test(a.command.trim())) {
      return `Invalid command "${a.command}". Commands may contain only letters, numbers, and _ @ . / - characters.`;
    }
    if (a.promptFlag !== undefined && (typeof a.promptFlag !== 'string' || !/^--?[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(a.promptFlag))) {
      return `Invalid prompt flag "${a.promptFlag}" for agent "${a.name}".`;
    }
  }
  return null;
}

export function createConfigRoutes(configStore: ConfigStore, onConfigChange?: (config: AppConfig) => void): Router {
  const router = Router();

  router.get('/', asyncHandler(async (_req, res) => {
    const config = await configStore.load();
    res.json(config);
  }));

  router.put('/', asyncHandler(async (req, res) => {
    const current = await configStore.load();
    const { defaultAgent, customAgents, agentFlags, notificationsEnabled, notifyOnWaiting, notifyOnDone, notifyOnPrChecks, notificationSound, showClock, clockShowSeconds, showStatusBar, restoreLayoutOnLaunch, othersFolderName, preventSleepWhileRunning, confirmCloseShell, exitSessionsOnQuit, confirmExitOnQuit, keyboardShortcuts, uiFontSize, codeFontSize, mosaicWaitingStyle, mosaicOrientation, density, debugToolsEnabled, ptyBackend, tileQuickAction, tileRunningIndicator, quickActionPromptedAt, introSeen, defaultTerminalEngine, defaultRunMode, confirmQuitDirectSessions, launchFolderRoots, showUsageMeter, usageMeterParts, usageWarnContext, usageWarnPlan, showPrStatus, inspectorSide, inspectorVisible, inspectorWidth, inspectorCollapsed, autoApprovalEnabled, claudeRenderer, defaultSessionView, betaActivityTimeline, betaWorktreeLifecycle, betaSessionTemplates, betaHandoff, betaSessionChains, showTips, discovery } = req.body;

    if (keyboardShortcuts !== undefined && !isStringRecord(keyboardShortcuts)) {
      res.status(400).json({ error: 'keyboardShortcuts must be an object of string action ids to string combos.' });
      return;
    }

    // Usage meter: strict. A malformed value is an error, never a silent default.
    if (usageMeterParts !== undefined && !isUsageMeterParts(usageMeterParts)) {
      res.status(400).json({ error: 'usageMeterParts must list ctx, plan, tok and model exactly once, each as { id, on: boolean }.' });
      return;
    }
    for (const [key, value] of [['usageWarnContext', usageWarnContext], ['usageWarnPlan', usageWarnPlan]] as const) {
      if (value !== undefined && !isWarnThresholds(value)) {
        res.status(400).json({ error: `${key} must be { amber, red }: numbers from 5 to 99, red above amber.` });
        return;
      }
    }

    if (inspectorCollapsed !== undefined && !isInspectorSectionList(inspectorCollapsed)) {
      res.status(400).json({ error: `inspectorCollapsed must be a list of at most ${INSPECTOR_SECTIONS_MAX} section ids.` });
      return;
    }

    if (agentFlags !== undefined) {
      const validationError = validateAgentFlags(agentFlags);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }
    }

    if (customAgents !== undefined) {
      const agentError = validateCustomAgents(customAgents);
      if (agentError) {
        res.status(400).json({ error: agentError });
        return;
      }
    }

    const rawOthersName = typeof othersFolderName === 'string' ? othersFolderName.trim() : undefined;
    const updated = {
      defaultAgent: defaultAgent ?? current.defaultAgent,
      customAgents: customAgents ?? current.customAgents,
      agentFlags: agentFlags ?? current.agentFlags,
      notificationsEnabled: notificationsEnabled ?? current.notificationsEnabled,
      notifyOnWaiting: notifyOnWaiting ?? current.notifyOnWaiting,
      notifyOnDone: notifyOnDone ?? current.notifyOnDone,
      notifyOnPrChecks: notifyOnPrChecks !== undefined ? !!notifyOnPrChecks : current.notifyOnPrChecks,
      notificationSound: notificationSound ?? current.notificationSound,
      showClock: showClock !== undefined ? !!showClock : current.showClock,
      clockShowSeconds: clockShowSeconds !== undefined ? !!clockShowSeconds : current.clockShowSeconds,
      showStatusBar: showStatusBar !== undefined ? !!showStatusBar : current.showStatusBar,
      restoreLayoutOnLaunch: restoreLayoutOnLaunch !== undefined ? !!restoreLayoutOnLaunch : current.restoreLayoutOnLaunch,
      othersFolderName: (rawOthersName && rawOthersName.length >= 1) ? rawOthersName : current.othersFolderName,
      preventSleepWhileRunning: preventSleepWhileRunning !== undefined ? !!preventSleepWhileRunning : current.preventSleepWhileRunning,
      confirmCloseShell: confirmCloseShell !== undefined ? !!confirmCloseShell : current.confirmCloseShell,
      exitSessionsOnQuit: exitSessionsOnQuit !== undefined ? !!exitSessionsOnQuit : current.exitSessionsOnQuit,
      confirmExitOnQuit: confirmExitOnQuit !== undefined ? !!confirmExitOnQuit : current.confirmExitOnQuit,
      keyboardShortcuts: keyboardShortcuts ?? current.keyboardShortcuts,
      uiFontSize: typeof uiFontSize === 'number' ? uiFontSize : current.uiFontSize,
      codeFontSize: typeof codeFontSize === 'number' ? codeFontSize : current.codeFontSize,
      mosaicWaitingStyle: (mosaicWaitingStyle === 'breathing' || mosaicWaitingStyle === 'flag')
        ? mosaicWaitingStyle
        : current.mosaicWaitingStyle,
      mosaicOrientation: (mosaicOrientation === 'horizontal' || mosaicOrientation === 'vertical')
        ? mosaicOrientation
        : current.mosaicOrientation,
      density: (density === 'compact' || density === 'default' || density === 'comfortable')
        ? density
        : current.density,
      debugToolsEnabled: debugToolsEnabled !== undefined ? !!debugToolsEnabled : current.debugToolsEnabled,
      ptyBackend: (ptyBackend === 'auto' || ptyBackend === 'tmux') ? ptyBackend : current.ptyBackend,
      tileQuickAction: isTileQuickAction(tileQuickAction) ? tileQuickAction : current.tileQuickAction,
      tileRunningIndicator: (tileRunningIndicator === 'hairline' || tileRunningIndicator === 'off')
        ? tileRunningIndicator
        : current.tileRunningIndicator,
      // Written once by the first-run picker; a string (incl. '') always wins so the
      // prompt can be re-armed by clearing it.
      quickActionPromptedAt: typeof quickActionPromptedAt === 'string'
        ? quickActionPromptedAt
        : current.quickActionPromptedAt,
      introSeen: typeof introSeen === 'string' ? introSeen : current.introSeen,
      // Validated against the union rather than passed through: this route
      // builds `updated` from an explicit allowlist, so a key that is merely
      // present in the request body but missing here is silently dropped —
      // which is exactly how the Settings engine picker came to look
      // unclickable (the PUT returned the old value, so the button never lit).
      defaultTerminalEngine: (defaultTerminalEngine === 'web' || defaultTerminalEngine === 'native')
        ? defaultTerminalEngine
        : current.defaultTerminalEngine,
      defaultRunMode: (defaultRunMode === 'persistent' || defaultRunMode === 'direct')
        ? defaultRunMode
        : current.defaultRunMode,
      confirmQuitDirectSessions: confirmQuitDirectSessions !== undefined
        ? !!confirmQuitDirectSessions
        : current.confirmQuitDirectSessions,
      launchFolderRoots: Array.isArray(launchFolderRoots)
        && launchFolderRoots.length <= 20
        && launchFolderRoots.every((r: unknown) => typeof r === 'string' && r.trim().length > 0 && r.length <= 512)
        ? launchFolderRoots.map((r: string) => r.trim())
        : current.launchFolderRoots,
      showUsageMeter: showUsageMeter !== undefined ? !!showUsageMeter : current.showUsageMeter,
      usageMeterParts: usageMeterParts !== undefined
        ? (usageMeterParts as AppConfig['usageMeterParts'])!.map((p) => ({ id: p.id, on: p.on }))
        : current.usageMeterParts,
      usageWarnContext: usageWarnContext !== undefined ? { amber: usageWarnContext.amber, red: usageWarnContext.red } : current.usageWarnContext,
      usageWarnPlan: usageWarnPlan !== undefined ? { amber: usageWarnPlan.amber, red: usageWarnPlan.red } : current.usageWarnPlan,
      showPrStatus: showPrStatus !== undefined ? !!showPrStatus : current.showPrStatus,
      inspectorSide: (inspectorSide === 'left' || inspectorSide === 'right') ? inspectorSide : current.inspectorSide,
      // Strict boolean: a truthy string must not flip the panel.
      inspectorVisible: typeof inspectorVisible === 'boolean' ? inspectorVisible : current.inspectorVisible,
      // A dragged width: clamp rather than reject, so a stale client never loses the save.
      inspectorWidth: typeof inspectorWidth === 'number' && Number.isFinite(inspectorWidth)
        ? Math.round(Math.min(INSPECTOR_WIDTH_MAX, Math.max(INSPECTOR_WIDTH_MIN, inspectorWidth)))
        : current.inspectorWidth,
      inspectorCollapsed: inspectorCollapsed !== undefined
        ? [...new Set(inspectorCollapsed as string[])]
        : current.inspectorCollapsed,
      // Strict boolean: only an explicit true turns the feature on.
      autoApprovalEnabled: typeof autoApprovalEnabled === 'boolean' ? autoApprovalEnabled : current.autoApprovalEnabled,
      claudeRenderer: (claudeRenderer === 'fullscreen' || claudeRenderer === 'classic' || claudeRenderer === 'inherit')
        ? claudeRenderer
        : current.claudeRenderer,
      defaultSessionView: (defaultSessionView === 'terminal' || defaultSessionView === 'chat')
        ? defaultSessionView
        : current.defaultSessionView,
      // Beta flags: strict booleans, like autoApprovalEnabled — a truthy string
      // must not switch on an experimental feature.
      betaActivityTimeline: typeof betaActivityTimeline === 'boolean' ? betaActivityTimeline : current.betaActivityTimeline,
      betaWorktreeLifecycle: typeof betaWorktreeLifecycle === 'boolean' ? betaWorktreeLifecycle : current.betaWorktreeLifecycle,
      betaSessionTemplates: typeof betaSessionTemplates === 'boolean' ? betaSessionTemplates : current.betaSessionTemplates,
      betaHandoff: typeof betaHandoff === 'boolean' ? betaHandoff : current.betaHandoff,
      betaSessionChains: typeof betaSessionChains === 'boolean' ? betaSessionChains : current.betaSessionChains,
      showTips: typeof showTips === 'boolean' ? showTips : current.showTips,
      discovery: discovery !== undefined ? sanitizeDiscovery(discovery, current.discovery) : current.discovery,
    };
    await configStore.save(updated);
    onConfigChange?.(updated);
    res.json(updated);
  }));

  return router;
}

export function createAgentRoutes(agentRegistry: AgentRegistry): Router {
  const router = Router();

  router.get('/detect', (_req, res) => {
    const agents = agentRegistry.detectInstalled();
    res.json({ agents });
  });

  return router;
}
