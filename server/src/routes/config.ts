import { Router } from 'express';
import type { ConfigStore } from '../persistence/ConfigStore.js';
import type { AgentRegistry } from '../services/AgentRegistry.js';
import type { AgentDefinition, AgentFlag, AppConfig, TileQuickAction } from '@argus/shared';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isUsageMeterParts, isWarnThresholds } from '../utils/usageMeter.js';
import { INSPECTOR_WIDTH_MIN, INSPECTOR_WIDTH_MAX, INSPECTOR_SECTION_ID, INSPECTOR_SECTIONS_MAX } from '../constants/inspector.js';

const TILE_QUICK_ACTIONS: readonly TileQuickAction[] = ['diff', 'files', 'shell', 'clone', 'restart', 'done', 'apply', 'none'];

function isTileQuickAction(v: unknown): v is TileQuickAction {
  return typeof v === 'string' && (TILE_QUICK_ACTIONS as readonly string[]).includes(v);
}

// Validate flag values stored in agentFlags config to prevent shell injection
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

function validateAgentFlags(agentFlags: Record<string, AgentFlag[]>): string | null {
  for (const [, flags] of Object.entries(agentFlags)) {
    for (const flag of flags) {
      if (!FLAG_PATTERN.test(flag.value.trim())) {
        return `Invalid flag value: "${flag.value}". Flags must start with - or -- and contain only safe characters.`;
      }
    }
  }
  return null;
}

function validateCustomAgents(customAgents: AgentDefinition[]): string | null {
  for (const a of customAgents) {
    if (!a.id || typeof a.id !== 'string') return 'Each custom agent needs an id.';
    if (!a.name?.trim()) return 'Each custom agent needs a name.';
    if (!a.command?.trim()) return `Agent "${a.name}" needs a command.`;
    if (!COMMAND_PATTERN.test(a.command.trim())) {
      return `Invalid command "${a.command}". Commands may contain only letters, numbers, and _ @ . / - characters.`;
    }
    if (a.promptFlag !== undefined && !/^--?[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(a.promptFlag)) {
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
    const { defaultAgent, customAgents, agentFlags, notificationsEnabled, notifyOnWaiting, notifyOnDone, notifyOnPrChecks, notificationSound, showClock, clockShowSeconds, othersFolderName, preventSleepWhileRunning, confirmCloseShell, exitSessionsOnQuit, confirmExitOnQuit, keyboardShortcuts, uiFontSize, codeFontSize, mosaicWaitingStyle, mosaicOrientation, debugToolsEnabled, ptyBackend, tileQuickAction, tileRunningIndicator, quickActionPromptedAt, introSeen, defaultTerminalEngine, defaultRunMode, confirmQuitDirectSessions, launchFolderRoots, showUsageMeter, usageMeterParts, usageWarnContext, usageWarnPlan, showPrStatus, inspectorSide, inspectorVisible, inspectorWidth, inspectorCollapsed, autoApprovalEnabled, claudeRenderer, defaultSessionView, betaActivityTimeline, betaWorktreeLifecycle, betaSessionTemplates, betaHandoff, betaSessionChains } = req.body;

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

    if (agentFlags) {
      const validationError = validateAgentFlags(agentFlags);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }
    }

    if (customAgents) {
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
