import { Router } from 'express';
import type { ConfigStore } from '../persistence/ConfigStore.js';
import type { AgentRegistry } from '../services/AgentRegistry.js';
import type { AgentDefinition, AgentFlag, AppConfig } from '@argus/shared';

// Validate flag values stored in agentFlags config to prevent shell injection
const FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9\-_.=:,/ ]*$/;
// Custom agent commands are spawned via the shell — restrict to safe characters
// (binary name + simple args), rejecting shell metacharacters.
const COMMAND_PATTERN = /^[a-zA-Z0-9_@./\- ]+$/;

function isStringRecord(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
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
  }
  return null;
}

export function createConfigRoutes(configStore: ConfigStore, onConfigChange?: (config: AppConfig) => void): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const config = await configStore.load();
    res.json(config);
  });

  router.put('/', async (req, res) => {
    const current = await configStore.load();
    const { defaultAgent, customAgents, agentFlags, notificationsEnabled, notifyOnWaiting, notifyOnDone, notificationSound, showClock, clockShowSeconds, othersFolderName, preventSleepWhileRunning, confirmCloseShell, exitSessionsOnQuit, confirmExitOnQuit, keyboardShortcuts, uiFontSize, codeFontSize, mosaicWaitingStyle } = req.body;

    if (keyboardShortcuts !== undefined && !isStringRecord(keyboardShortcuts)) {
      res.status(400).json({ error: 'keyboardShortcuts must be an object of string action ids to string combos.' });
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
    };
    await configStore.save(updated);
    onConfigChange?.(updated);
    res.json(updated);
  });

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
