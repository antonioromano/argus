import { Router } from 'express';
import type { SessionManager } from '../services/SessionManager.js';
import type { OrderStore } from '../persistence/OrderStore.js';
import type { GroupStore } from '../persistence/GroupStore.js';
import type { ConfigStore } from '../persistence/ConfigStore.js';
import type { CreateSessionRequest, SessionGroup } from '@argus/shared';

// Only allow safe flag characters — blocks shell metacharacters like ; | & ` $() etc.
const FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9\-_.=:,/]*$/;

function validateFlags(flags: string[]): string | null {
  for (const flag of flags) {
    if (!FLAG_PATTERN.test(flag.trim())) {
      return `Invalid flag: "${flag}". Flags must start with - or -- and contain only safe characters.`;
    }
  }
  return null;
}

// Enforce single-membership: a session id may appear in at most one group (first wins).
function dedupeGroupMembership(groups: SessionGroup[]): SessionGroup[] {
  const seen = new Set<string>();
  return groups.map((g) => ({
    ...g,
    sessionIds: g.sessionIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true))),
  }));
}

export function createSessionRoutes(manager: SessionManager, orderStore: OrderStore, groupStore: GroupStore, configStore: ConfigStore): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(manager.getAllSessions());
  });

  router.get('/order', async (_req, res) => {
    const order = await orderStore.load();
    res.json({ order });
  });

  router.put('/order', async (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      res.status(400).json({ error: 'order must be an array of session IDs' });
      return;
    }
    await orderStore.save(order);
    res.json({ order });
  });

  router.get('/groups', async (_req, res) => {
    const groups = await groupStore.load();
    res.json({ groups });
  });

  router.put('/groups', async (req, res) => {
    const { groups } = req.body;
    if (!Array.isArray(groups)) {
      res.status(400).json({ error: 'groups must be an array of SessionGroup' });
      return;
    }
    const deduped = dedupeGroupMembership(groups as SessionGroup[]);
    await groupStore.save(deduped);
    res.json({ groups: deduped });
  });

  router.get('/:id', (req, res) => {
    const session = manager.getSessionInfo(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  });

  router.post('/', async (req, res) => {
    const { folderPath, name, agentType, flags, worktreeBranch, worktreeBase } = req.body as CreateSessionRequest;

    if (!folderPath) {
      res.status(400).json({ error: 'folderPath is required' });
      return;
    }

    if (flags?.length) {
      const validationError = validateFlags(flags);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }
    }

    try {
      const session = await manager.createSession(folderPath, name, agentType, flags, undefined, undefined, worktreeBranch, worktreeBase);

      // Update sticky defaults: record which flags were enabled for this agent
      const config = await configStore.load();
      const agentFlagDefs = config.agentFlags[session.agentType];
      if (agentFlagDefs?.length) {
        config.agentFlags[session.agentType] = agentFlagDefs.map((f) => ({
          ...f,
          enabled: (flags || []).includes(f.value),
        }));
        await configStore.save(config);
      }

      res.status(201).json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      res.status(400).json({ error: message });
    }
  });

  router.patch('/:id/restart', async (req, res) => {
    try {
      const session = await manager.restartSession(req.params.id);
      res.json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restart session';
      res.status(404).json({ error: message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await manager.destroySession(req.params.id);
      res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete session';
      res.status(404).json({ error: message });
    }
  });

  return router;
}
