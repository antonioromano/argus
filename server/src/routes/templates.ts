import { Router } from 'express';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import type {
  AgentDefinition,
  AppConfig,
  LaunchTemplateResponse,
  SessionGroup,
  SessionInfo,
  SessionTemplate,
  TemplateErrorResponse,
  TemplateListResponse,
  TemplateSpec,
  TemplateSpecResult,
} from '@argus/shared';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateFlags } from '../utils/flags.js';
import { parseTemplateInput, uniqueGroupName, validateSpecs } from '../services/templates.js';

/** Group palette key for a template's group (client `constants/groupColors`). */
const TEMPLATE_GROUP_COLOR = 'teal';

/** Beta F10 wiring. `isEnabled` false → every route 404s. */
export interface TemplateDeps {
  isEnabled: () => boolean;
  store: { load(): Promise<SessionTemplate[]>; save(list: SessionTemplate[]): Promise<void> };
  groupStore: { load(): Promise<SessionGroup[]>; save(groups: SessionGroup[]): Promise<void> };
  loadConfig: () => Promise<AppConfig>;
  agentRegistry: { getById(id: string, customAgents: AgentDefinition[]): AgentDefinition | undefined };
  /** Start one shell; worktree creation and the quoted initial prompt live in createSession. */
  createSession: (spec: TemplateSpec, name: string, flags: string[]) => Promise<SessionInfo>;
  /** Give a new shell to a window; false when the window is unknown. */
  assignWindow?: (sessionId: string, windowId: string) => Promise<boolean>;
  /** groups.json changed behind the clients' backs — tell them to refetch. */
  onGroupsChanged?: () => void;
  newId?: () => string;
  now?: () => Date;
}

function badRequest(res: Response, body: TemplateErrorResponse): void {
  res.status(400).json(body);
}

/** `/api/templates` — CRUD + launch. Mounted behind the auth middleware. No deep link reaches it. */
export function createTemplateRoutes(deps: TemplateDeps): Router {
  const router = Router();
  const newId = deps.newId ?? randomUUID;
  const now = () => deps.now?.() ?? new Date();
  // One writer at a time: templates.json and groups.json are read-modify-write.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  router.use((_req, res, next) => {
    if (!deps.isEnabled()) {
      res.status(404).json({ error: 'Session templates are a beta feature that is switched off.' });
      return;
    }
    next();
  });

  const specDeps = async () => ({ agentRegistry: deps.agentRegistry, customAgents: (await deps.loadConfig()).customAgents ?? [] });

  /** Parse + fully validate a save body; answers the 400 itself and returns null on failure. */
  async function readBody(raw: unknown, res: Response): Promise<{ name: string; specs: TemplateSpec[] } | null> {
    const parsed = parseTemplateInput(raw);
    if (!parsed.ok) {
      badRequest(res, { error: parsed.error, ...(parsed.specErrors ? { specErrors: parsed.specErrors } : {}) });
      return null;
    }
    const v = await validateSpecs(parsed.specs, await specDeps());
    if (!v.ok) {
      badRequest(res, { error: 'Some sessions are invalid', specErrors: v.specErrors });
      return null;
    }
    return { name: parsed.name, specs: v.specs };
  }

  router.get('/', asyncHandler(async (_req, res) => {
    const out: TemplateListResponse = { templates: await deps.store.load() };
    res.setHeader('Cache-Control', 'no-cache');
    res.json(out);
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const body = await readBody(req.body, res);
    if (!body) return;
    const created = await serial(async () => {
      const stamp = now().toISOString();
      const t: SessionTemplate = { id: newId(), name: body.name, specs: body.specs, createdAt: stamp, updatedAt: stamp };
      await deps.store.save([...(await deps.store.load()), t]);
      return t;
    });
    res.status(201).json(created);
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = await readBody(req.body, res);
    if (!body) return;
    const updated = await serial(async () => {
      const list = await deps.store.load();
      const existing = list.find((t) => t.id === id);
      if (!existing) return null;
      const t: SessionTemplate = { ...existing, name: body.name, specs: body.specs, updatedAt: now().toISOString() };
      await deps.store.save(list.map((x) => (x.id === id ? t : x)));
      return t;
    });
    if (!updated) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json(updated);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const removed = await serial(async () => {
      const list = await deps.store.load();
      if (!list.some((t) => t.id === id)) return false;
      await deps.store.save(list.filter((t) => t.id !== id));
      return true;
    });
    if (!removed) { res.status(404).json({ error: 'Template not found' }); return; }
    res.status(204).send();
  }));

  // POST /api/templates/:id/launch — body { windowId? }. Best effort: every spec
  // is re-validated, each valid one is started in order, and the ones that
  // started go into a NEW group. A failure never rolls back the others.
  router.post('/:id/launch', asyncHandler(async (req, res) => {
    const template = (await deps.store.load()).find((t) => t.id === String(req.params.id));
    if (!template) { res.status(404).json({ error: 'Template not found' }); return; }
    const rawWindow = (req.body as { windowId?: unknown } | undefined)?.windowId;
    if (rawWindow !== undefined && (typeof rawWindow !== 'string' || !rawWindow || rawWindow.length > 100)) {
      badRequest(res, { error: 'windowId must be a string' });
      return;
    }

    const config = await deps.loadConfig();
    const sd = { agentRegistry: deps.agentRegistry, customAgents: config.customAgents ?? [] };
    const results: TemplateSpecResult[] = [];
    // Sequential on purpose: two worktrees of one repo must not race in `git worktree add`.
    for (const [index, raw] of template.specs.entries()) {
      const v = await validateSpecs([raw], sd);
      if (!v.ok) { results.push({ index, ok: false, error: v.specErrors[0]!.error }); continue; }
      const spec = v.specs[0]!;
      // The agent's sticky flag defaults — what the create sheet preselects.
      const flags = (config.agentFlags?.[spec.agent] ?? []).filter((f) => f.enabled).map((f) => f.value);
      const safeFlags = flags.length && !validateFlags(flags) ? flags : [];
      const name = spec.name ?? (spec.worktreeBranch ? `${path.basename(spec.folder)} · ${spec.worktreeBranch}` : path.basename(spec.folder));
      try {
        const session = await deps.createSession(spec, name, safeFlags);
        if (typeof rawWindow === 'string') await deps.assignWindow?.(session.id, rawWindow).catch(() => false);
        results.push({ index, ok: true, session });
      } catch (err) {
        results.push({ index, ok: false, error: err instanceof Error ? err.message : 'Failed to start the session' });
      }
    }

    const started = results.flatMap((r) => (r.ok ? [r.session.id] : []));
    let group: SessionGroup | null = null;
    if (started.length) {
      group = await serial(async () => {
        const groups = await deps.groupStore.load();
        // Single membership: a new session can't be anywhere yet, but stay safe.
        const ids = new Set(started);
        const cleaned = groups.map((g) => ({ ...g, sessionIds: g.sessionIds.filter((s) => !ids.has(s)) }));
        const g: SessionGroup = {
          id: newId(),
          name: uniqueGroupName(template.name, new Set(groups.map((x) => x.name)), now()),
          color: TEMPLATE_GROUP_COLOR,
          collapsed: false,
          sessionIds: started,
        };
        await deps.groupStore.save([...cleaned, g]);
        return g;
      });
      deps.onGroupsChanged?.();
    }
    const out: LaunchTemplateResponse = { group, results };
    res.status(started.length ? 201 : 200).json(out);
  }));

  return router;
}
