import { Router } from 'express';
import type { ConfigStore } from '../persistence/ConfigStore.js';
import type { AgentRegistry } from '../services/AgentRegistry.js';
import type { AgentFlag } from '@argus/shared';

// Validate flag values stored in agentFlags config to prevent shell injection
const FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9\-_.=:,/ ]*$/;

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

export function createConfigRoutes(configStore: ConfigStore): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const config = await configStore.load();
    res.json(config);
  });

  router.put('/', async (req, res) => {
    const current = await configStore.load();
    const { defaultAgent, customAgents, agentFlags, notificationsEnabled } = req.body;

    if (agentFlags) {
      const validationError = validateAgentFlags(agentFlags);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }
    }

    const updated = {
      defaultAgent: defaultAgent ?? current.defaultAgent,
      customAgents: customAgents ?? current.customAgents,
      agentFlags: agentFlags ?? current.agentFlags,
      notificationsEnabled: notificationsEnabled ?? current.notificationsEnabled,
    };
    await configStore.save(updated);
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
