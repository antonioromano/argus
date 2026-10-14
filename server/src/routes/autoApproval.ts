import { Router } from 'express';
import path from 'path';
import type { AutoApprovalFolder, AutoApprovalFolderState } from '@argus/shared';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { AutoApprovalStore } from '../persistence/AutoApprovalStore.js';
import type { AutoApprovalService } from '../services/autoApproval/AutoApprovalService.js';
import { realFolder } from '../services/autoApproval/AutoApprovalService.js';
import { validateRuleInput } from '../services/autoApproval/matcher.js';

export interface AutoApprovalRouteDeps {
  store: Pick<AutoApprovalStore, 'rulesFor' | 'folderList' | 'addRule' | 'removeRule'>;
  service: Pick<AutoApprovalService, 'auditForSessions'>;
  /** Every session the server knows (id, folder, status). */
  listSessions: () => Array<{ id: string; folderPath: string; status: string }>;
}

/**
 * F5 rule management. Mounted behind the bearer-auth middleware. Every folder
 * argument must be absolute and, after realpath, either the folder of a known
 * session or (read/delete only) a folder that already holds rules — so a
 * client cannot plant rules for an arbitrary path.
 */
export function createAutoApprovalRoutes(deps: AutoApprovalRouteDeps): Router {
  const router = Router();

  /** realpath'd session folders → the ids of the sessions in each. */
  const sessionFolders = (): Map<string, { ids: string[]; live: boolean }> => {
    const out = new Map<string, { ids: string[]; live: boolean }>();
    for (const s of deps.listSessions()) {
      const real = realFolder(s.folderPath);
      if (!real) continue;
      const entry = out.get(real) ?? { ids: [], live: false };
      entry.ids.push(s.id);
      if (s.status !== 'exited') entry.live = true;
      out.set(real, entry);
    }
    return out;
  };

  /** The canonical folder, or null when the input is not acceptable. */
  const resolveFolder = (raw: unknown, allowRuleOnly: boolean): string | null => {
    if (typeof raw !== 'string' || !raw || raw.length > 4096 || !path.isAbsolute(raw)) return null;
    const real = realFolder(raw);
    if (real && sessionFolders().has(real)) return real;
    // A folder whose sessions are gone can still be read and cleaned up. It is
    // matched as stored, since it may no longer exist on disk.
    const stored = real ?? path.resolve(raw);
    if (allowRuleOnly && deps.store.folderList().includes(stored)) return stored;
    return null;
  };

  router.get('/folders', (_req, res) => {
    const folders = sessionFolders();
    const all = new Set([...folders.keys(), ...deps.store.folderList()]);
    const list: AutoApprovalFolder[] = [...all].sort().map((folder) => ({
      folder,
      ruleCount: deps.store.rulesFor(folder).length,
      hasSession: folders.get(folder)?.live ?? false,
    }));
    res.json({ folders: list });
  });

  router.get('/rules', (req, res) => {
    const folder = resolveFolder(req.query.folder, true);
    if (!folder) {
      res.status(400).json({ error: 'folder must be an absolute path of a session folder' });
      return;
    }
    const ids = sessionFolders().get(folder)?.ids ?? [];
    const state: AutoApprovalFolderState = {
      folder,
      rules: deps.store.rulesFor(folder),
      audit: deps.service.auditForSessions(ids),
    };
    res.json(state);
  });

  router.post('/rules', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const folder = resolveFolder(body.folder, false);
    if (!folder) {
      res.status(400).json({ error: 'folder must be an absolute path of a session folder' });
      return;
    }
    const checked = validateRuleInput({ tool: body.tool, bashPrefix: body.bashPrefix, pathGlob: body.pathGlob });
    if (!checked.ok) {
      res.status(400).json({ error: checked.error });
      return;
    }
    const dup = deps.store.rulesFor(folder).some((r) =>
      r.tool === checked.tool && r.bashPrefix === checked.bashPrefix && r.pathGlob === checked.pathGlob);
    if (dup) {
      res.status(409).json({ error: 'That rule already exists for this folder' });
      return;
    }
    try {
      const rule = await deps.store.addRule(folder, { tool: checked.tool, bashPrefix: checked.bashPrefix, pathGlob: checked.pathGlob });
      res.status(201).json(rule);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not add rule' });
    }
  }));

  router.delete('/rules/:id', asyncHandler(async (req, res) => {
    const folder = resolveFolder(req.query.folder, true);
    if (!folder) {
      res.status(400).json({ error: 'folder must be an absolute path of a session folder' });
      return;
    }
    const removed = await deps.store.removeRule(folder, req.params.id ?? '');
    if (!removed) {
      res.status(404).json({ error: 'No such rule' });
      return;
    }
    res.status(204).end();
  }));

  return router;
}
