import type { AppConfig, Launcher, LaunchActionResult, LaunchRequest, RunResolution, SessionInfo, ValidatedLaunch, ValidationResult } from '@argus/shared';
import type { AgentRegistry } from '../AgentRegistry.js';
import { validateLaunch, configEntryPath } from './validateLaunch.js';

const ID_RE = /^[a-z0-9-]{1,40}$/;
const MAX_LABEL = 60;

export interface LaunchServiceDeps {
  store: { load(): Promise<Launcher[]>; save(l: Launcher[]): Promise<void> };
  loadConfig: () => Promise<AppConfig>;
  agentRegistry: AgentRegistry;
  home: string;
  findLiveByLauncher: (launcherId: string) => SessionInfo | undefined;
  now?: () => Date;
}

/** Deep-link launch logic shared by the Electron gate. No REST surface. */
export class LaunchService {
  private writeQueue: Promise<unknown> = Promise.resolve();
  constructor(private deps: LaunchServiceDeps) {}

  async validate(req: LaunchRequest): Promise<ValidationResult> {
    return validateLaunch(req, { agentRegistry: this.deps.agentRegistry, config: await this.deps.loadConfig(), home: this.deps.home });
  }

  list(): Promise<Launcher[]> {
    return this.deps.store.load();
  }

  async resolveRun(launcherId: string): Promise<RunResolution> {
    const launcher = (await this.deps.store.load()).find((l) => l.id === launcherId);
    if (!launcher) return { kind: 'unknown' };
    const live = this.deps.findLiveByLauncher(launcherId);
    if (live) return { kind: 'live', sessionId: live.id };
    const v = await this.validate(launcher.request);
    if (!v.ok) return { kind: 'invalid', error: v.error };
    const reasons: string[] = [];
    if (v.value.agentCommand !== launcher.agentCommand) {
      reasons.push(`agent command changed (${launcher.agentCommand} → ${v.value.agentCommand})`);
    }
    // Entries carry a content hash, so an edit (not just a file appearing) counts.
    const before = new Set(launcher.folderConfigAtSave);
    const after = new Set(v.value.folderAgentConfig);
    const differing = [...before].filter((e) => !after.has(e)).concat([...after].filter((e) => !before.has(e)));
    if (differing.length) {
      const paths = [...new Set(differing.map(configEntryPath))].sort();
      reasons.push(`folder agent config changed (${paths.join(', ')})`);
    }
    if (reasons.length) {
      const validated = { ...v.value, warnings: [...v.value.warnings, { kind: 'launcher-changed' as const, detail: `Since this launcher was saved: ${reasons.join('; ')}` }] };
      return { kind: 'changed', launcher, validated };
    }
    return { kind: 'ready', launcher, validated: v.value };
  }

  add(input: { id: string; label: string; validated: ValidatedLaunch; overwrite?: boolean }): Promise<LaunchActionResult> {
    return this.serial(async () => {
      if (!ID_RE.test(input.id)) return { ok: false, error: 'Launcher id must be 1–40 chars of a-z, 0-9, -' };
      const label = input.label.trim();
      if (!label || label.length > MAX_LABEL) return { ok: false, error: `Label must be 1–${MAX_LABEL} characters` };
      if (input.validated.request.worktree) return { ok: false, error: 'A launcher can’t create a worktree (it would reuse the branch every run)' };
      const list = await this.deps.store.load();
      const exists = list.some((l) => l.id === input.id);
      if (exists && !input.overwrite) return { ok: false, error: `Launcher "${input.id}" already exists` };
      const { worktree: _w, base: _b, ...request } = input.validated.request;
      const launcher: Launcher = {
        id: input.id,
        label,
        request,
        agentCommand: input.validated.agentCommand,
        folderConfigAtSave: [...input.validated.folderAgentConfig],
        createdAt: (this.deps.now?.() ?? new Date()).toISOString(),
      };
      await this.deps.store.save(exists ? list.map((l) => (l.id === input.id ? launcher : l)) : [...list, launcher]);
      return { ok: true };
    });
  }

  rename(id: string, label: string): Promise<LaunchActionResult> {
    return this.serial(async () => {
      const clean = label.trim();
      if (!clean || clean.length > MAX_LABEL) return { ok: false, error: `Label must be 1–${MAX_LABEL} characters` };
      const list = await this.deps.store.load();
      if (!list.some((l) => l.id === id)) return { ok: false, error: 'No such launcher' };
      await this.deps.store.save(list.map((l) => (l.id === id ? { ...l, label: clean } : l)));
      return { ok: true };
    });
  }

  remove(id: string): Promise<LaunchActionResult> {
    return this.serial(async () => {
      const list = await this.deps.store.load();
      if (!list.some((l) => l.id === id)) return { ok: false, error: 'No such launcher' };
      await this.deps.store.save(list.filter((l) => l.id !== id));
      return { ok: true };
    });
  }

  /** Load-modify-save on one file: serialize so concurrent writes can't drop an entry. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(fn, fn);
    this.writeQueue = run.catch(() => {});
    return run;
  }
}
