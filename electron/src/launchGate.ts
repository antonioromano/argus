import type {
  LaunchActionResult, LaunchRequest, PendingLaunchView, RunResolution, SaveAsLauncher,
  ValidatedLaunch, ValidationResult,
} from '@argus/shared';
import type { ParsedLink } from './launchLink.js';

export const LIMITS = { maxPending: 5, expiryMs: 600_000, burstCount: 3, burstWindowMs: 10_000, errorToastMs: 10_000 } as const;

export interface GateDeps {
  now(): number;
  newId(): string;
  validate(req: LaunchRequest): Promise<ValidationResult>;
  resolveRun(id: string): Promise<RunResolution>;
  launch(v: ValidatedLaunch, windowId: string, launcherId?: string): Promise<{ id: string }>;
  saveLauncher(input: { id: string; label: string; validated: ValidatedLaunch; overwrite?: boolean }): Promise<LaunchActionResult>;
  targetWindow(): string;
  changed(windowId: string): void;
  toast(windowId: string, message: string, tone: 'ok' | 'warn' | 'danger'): void;
  highlight(windowId: string, sessionId: string): void;
  notifyIfBackground(view: PendingLaunchView, windowId: string): void;
}

export interface LaunchGate {
  handle(link: ParsedLink): Promise<void>;
  list(windowId: string): PendingLaunchView[];
  approve(id: string, saveAs?: SaveAsLauncher): Promise<LaunchActionResult>;
  discard(id: string): void;
  tick(): void;
  has(id: string): boolean;
  windowOf(id: string): string | undefined;
  rehome(closedWindowId: string): void;
}

interface Entry { view: PendingLaunchView; validated: ValidatedLaunch; windowId: string; key: string }

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

export function createLaunchGate(deps: GateDeps): LaunchGate {
  const entries = new Map<string, Entry>();
  let recent: number[] = [];
  let lastErrorToast = -Infinity;
  let suppressedErrors = 0;

  const errorToast = (windowId: string, message: string) => {
    const t = deps.now();
    if (t - lastErrorToast < LIMITS.errorToastMs) { suppressedErrors++; return; }
    const extra = suppressedErrors ? ` (${suppressedErrors} more invalid link${suppressedErrors === 1 ? '' : 's'} ignored)` : '';
    suppressedErrors = 0;
    lastErrorToast = t;
    deps.toast(windowId, message + extra, 'danger');
  };

  const addCard = (validated: ValidatedLaunch, source: 'new' | 'run', launcherId?: string, label?: string): Entry | undefined => {
    const windowId = deps.targetWindow();
    const key = JSON.stringify([source, launcherId ?? '', validated.request]);
    for (const e of entries.values()) {
      if (e.key === key && e.view.state !== 'expired') { deps.changed(e.windowId); return e; }
    }
    if (entries.size >= LIMITS.maxPending) {
      deps.toast(windowId, 'Too many pending launches, link ignored', 'warn');
      return undefined;
    }
    const r = validated.request;
    const view: PendingLaunchView = {
      id: deps.newId(), source, launcherId,
      label: label ?? r.name ?? basename(r.folder),
      agent: r.agent, folder: r.folder, args: validated.args, prompt: r.prompt, command: validated.command,
      engine: r.engine, mode: r.mode, name: r.name, worktree: r.worktree, base: r.base,
      warnings: validated.warnings, state: 'pending', receivedAt: deps.now(),
      canSaveAsLauncher: source === 'new' && !r.worktree,
    };
    const entry: Entry = { view, validated, windowId, key };
    entries.set(view.id, entry);
    deps.changed(windowId);
    deps.notifyIfBackground(view, windowId);
    return entry;
  };

  const withinBurst = () => {
    const t = deps.now();
    recent = recent.filter((x) => t - x < LIMITS.burstWindowMs);
    if (recent.length >= LIMITS.burstCount) {
      console.warn('[launch] burst limit: link dropped');
      return false;
    }
    recent.push(t);
    return true;
  };

  return {
    async handle(link) {
      if (!withinBurst()) return;
      const w = deps.targetWindow();
      if (!link.ok) { errorToast(w, `Launch link rejected: ${link.error}`); return; }
      if (link.kind === 'notif') return; // main routes notif before calling the gate
      if (link.kind === 'new') {
        const v = await deps.validate(link.request);
        if (!v.ok) { errorToast(w, `Launch link rejected: ${v.error}`); return; }
        addCard(v.value, 'new');
        return;
      }
      const r = await deps.resolveRun(link.launcherId);
      switch (r.kind) {
        case 'unknown': errorToast(w, `No launcher "${link.launcherId}"`); return;
        case 'invalid': errorToast(w, `Launcher "${link.launcherId}": ${r.error}`); return;
        case 'live': deps.highlight(w, r.sessionId); return;
        case 'changed': addCard(r.validated, 'run', r.launcher.id, r.launcher.label); return;
        case 'ready':
          try {
            const s = await deps.launch(r.validated, w, r.launcher.id);
            deps.toast(w, `Started ${r.launcher.label}`, 'ok');
            deps.highlight(w, s.id);
          } catch (e) {
            const card = addCard(r.validated, 'run', r.launcher.id, r.launcher.label);
            if (card) { card.view.state = 'error'; card.view.error = (e as Error).message; deps.changed(card.windowId); }
          }
      }
    },

    list(windowId) {
      return [...entries.values()].filter((e) => e.windowId === windowId).map((e) => ({ ...e.view }));
    },

    async approve(id, saveAs) {
      const e = entries.get(id);
      if (!e) return { ok: false, error: 'No such pending launch' };
      if (e.view.state === 'expired') return { ok: false, error: 'This launch expired' };
      if (e.view.state === 'starting') return { ok: false, error: 'Already starting' };
      if (saveAs && !e.view.canSaveAsLauncher) return { ok: false, error: 'This launch can’t be saved as a launcher' };
      e.view.state = 'starting'; e.view.error = undefined; deps.changed(e.windowId);
      try {
        if (saveAs) {
          const saved = await deps.saveLauncher({ id: saveAs.id, label: saveAs.label, validated: e.validated, overwrite: saveAs.overwrite });
          if (!saved.ok) { e.view.state = 'pending'; e.view.error = saved.error; deps.changed(e.windowId); return saved; }
        }
        const launcherId = saveAs?.id ?? e.view.launcherId;
        const s = await deps.launch(e.validated, e.windowId, launcherId);
        entries.delete(id);
        deps.changed(e.windowId);
        deps.highlight(e.windowId, s.id);
        return { ok: true };
      } catch (err) {
        e.view.state = 'error'; e.view.error = (err as Error).message; deps.changed(e.windowId);
        return { ok: false, error: (err as Error).message };
      }
    },

    discard(id) {
      const e = entries.get(id);
      if (!e) return;
      entries.delete(id);
      deps.changed(e.windowId);
    },

    tick() {
      const t = deps.now();
      for (const e of entries.values()) {
        if (e.view.state === 'pending' && t - e.view.receivedAt > LIMITS.expiryMs) {
          e.view.state = 'expired';
          deps.changed(e.windowId);
        }
      }
    },

    has: (id) => entries.has(id),
    windowOf: (id) => entries.get(id)?.windowId,

    rehome(closed) {
      let moved = false;
      for (const e of entries.values()) if (e.windowId === closed) { e.windowId = 'main'; moved = true; }
      if (moved) deps.changed('main');
    },
  };
}
