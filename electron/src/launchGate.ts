import type {
  LaunchActionResult, LaunchRequest, PendingLaunchView, RunResolution, SaveAsLauncher,
  ValidatedLaunch, ValidationResult,
} from '@argus/shared';
import type { ParsedLink } from './launchLink.js';

export const LIMITS = { maxPending: 5, expiryMs: 600_000, burstCount: 3, burstWindowMs: 10_000, errorToastMs: 10_000, maxPendingMcp: 3 } as const;

export interface GateDeps {
  now(): number;
  newId(): string;
  validate(req: LaunchRequest): Promise<ValidationResult>;
  resolveRun(id: string): Promise<RunResolution>;
  launch(v: ValidatedLaunch, windowId: string, launcherId?: string, spawnedBy?: string): Promise<{ id: string }>;
  saveLauncher(input: { id: string; label: string; validated: ValidatedLaunch; overwrite?: boolean }): Promise<LaunchActionResult>;
  targetWindow(): string;
  /** Pending cards of `windowId` changed. `added` = a card appeared or a dedupe
   *  hit re-focused one (main may bring the window forward); `updated` = state
   *  change, expiry, rehome (main must never steal focus for these). */
  changed(windowId: string, reason: 'added' | 'updated'): void;
  toast(windowId: string, message: string, tone: 'ok' | 'warn' | 'danger'): void;
  highlight(windowId: string, sessionId: string): void;
  notifyIfBackground(view: PendingLaunchView, windowId: string): void;
}

/** The Argus session behind an MCP start_session call (F10). */
export interface McpRequester { sessionId: string; name: string }
export type McpLaunchDecision = { ok: true; sessionId: string } | { ok: false; error: string };

export interface LaunchGate {
  handle(link: ParsedLink): Promise<void>;
  /** MCP start_session: a card (or a direct start for a trusted requester),
   *  resolved once the user starts, discards or lets it expire. */
  request(validated: ValidatedLaunch, requester: McpRequester, signal?: AbortSignal): Promise<McpLaunchDecision>;
  list(windowId: string): PendingLaunchView[];
  /** `trustRequester`: an MCP card's "don't ask again" — later requests from
   *  the same session start without a card until Argus restarts. */
  approve(id: string, saveAs?: SaveAsLauncher, trustRequester?: boolean): Promise<LaunchActionResult>;
  discard(id: string): void;
  tick(): void;
  has(id: string): boolean;
  windowOf(id: string): string | undefined;
  rehome(closedWindowId: string): void;
}

interface Entry {
  view: PendingLaunchView; validated: ValidatedLaunch; windowId: string; key: string; savedAs?: string;
  /** source 'mcp': who asked, and the start_session calls waiting on this card. */
  requester?: McpRequester;
  waiters?: ((d: McpLaunchDecision) => void)[];
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

export function createLaunchGate(deps: GateDeps): LaunchGate {
  const entries = new Map<string, Entry>();
  let recent: number[] = [];
  let lastErrorToast = -Infinity;
  let suppressedErrors = 0;
  let lastBurstWarnWindow = -Infinity;
  const inFlightRuns = new Set<string>();
  /** Requester session ids the user chose to stop asking about (memory only). */
  const trusted = new Set<string>();
  /** Direct (trusted) MCP starts — their own window, so they never eat the links' burst budget. */
  let mcpRecent: number[] = [];
  const mcpWithinBurst = () => {
    const t = deps.now();
    mcpRecent = mcpRecent.filter((x) => t - x < LIMITS.burstWindowMs);
    if (mcpRecent.length >= LIMITS.burstCount) return false;
    mcpRecent.push(t);
    return true;
  };

  const settle = (e: Entry, d: McpLaunchDecision) => {
    for (const w of e.waiters?.splice(0) ?? []) w(d);
  };

  const errorToast = (windowId: string, message: string) => {
    const t = deps.now();
    if (t - lastErrorToast < LIMITS.errorToastMs) { suppressedErrors++; return; }
    const extra = suppressedErrors ? ` (${suppressedErrors} more invalid link${suppressedErrors === 1 ? '' : 's'} ignored)` : '';
    suppressedErrors = 0;
    lastErrorToast = t;
    deps.toast(windowId, message + extra, 'danger');
  };

  const addCard = (validated: ValidatedLaunch, source: PendingLaunchView['source'], launcherId?: string, label?: string, requester?: McpRequester): Entry | undefined => {
    const windowId = deps.targetWindow();
    const q = validated.request;
    const key = JSON.stringify([source, launcherId ?? '', q.agent, q.folder, q.flags, q.prompt ?? null, q.engine ?? null, q.mode ?? null, q.name ?? null, q.worktree ?? null, q.base ?? null]);
    // Links dedupe (a double click is one launch). MCP calls never do: two
    // identical start_session calls are two workers, each with its own answer.
    if (source !== 'mcp') {
      for (const e of entries.values()) {
        if (e.key === key && e.view.state !== 'expired') { deps.changed(e.windowId, 'added'); return e; }
      }
    }
    // Separate caps, so a runaway orchestrator can't crowd out the user's links.
    const live = [...entries.values()].filter((e) => e.view.state !== 'expired' && (e.view.source === 'mcp') === (source === 'mcp'));
    if (source === 'mcp' ? live.length >= LIMITS.maxPendingMcp : live.length >= LIMITS.maxPending) {
      if (source !== 'mcp') deps.toast(windowId, 'Too many pending launches, link ignored', 'warn');
      return undefined;
    }
    const r = validated.request;
    const view: PendingLaunchView = {
      id: deps.newId(), source, launcherId, requestedBy: requester?.name,
      label: label ?? r.name ?? basename(r.folder),
      agent: r.agent, folder: r.folder, args: validated.args, prompt: r.prompt, command: validated.command,
      engine: r.engine, mode: r.mode, name: r.name, worktree: r.worktree, base: r.base,
      warnings: validated.warnings, state: 'pending', receivedAt: deps.now(),
      canSaveAsLauncher: source === 'new' && !r.worktree,
    };
    const entry: Entry = { view, validated, windowId, key, requester, waiters: requester ? [] : undefined };
    entries.set(view.id, entry);
    deps.changed(windowId, 'added');
    deps.notifyIfBackground(view, windowId);
    return entry;
  };

  const withinBurst = () => {
    const t = deps.now();
    recent = recent.filter((x) => t - x < LIMITS.burstWindowMs);
    if (recent.length >= LIMITS.burstCount) {
      const windowStart = recent[0];
      if (windowStart !== lastBurstWarnWindow) {
        lastBurstWarnWindow = windowStart;
        console.warn('[launch] burst limit: link dropped');
      }
      return false;
    }
    recent.push(t);
    return true;
  };

  return {
    async handle(link) {
      if (link.ok && link.kind === 'notif') return; // main routes notif before calling the gate
      if (!withinBurst()) return;
      const w = deps.targetWindow();
      if (!link.ok) { errorToast(w, `Launch link rejected: ${link.error}`); return; }
      if (link.kind === 'new') {
        const v = await deps.validate(link.request);
        if (!v.ok) { errorToast(w, `Launch link rejected: ${v.error}`); return; }
        addCard(v.value, 'new');
        return;
      }
      if (inFlightRuns.has(link.launcherId)) return;
      inFlightRuns.add(link.launcherId);
      try {
        const r = await deps.resolveRun(link.launcherId);
        switch (r.kind) {
          case 'unknown': errorToast(w, `No launcher "${link.launcherId}"`); return;
          case 'invalid': errorToast(w, `Launcher "${link.launcherId}": ${r.error}`); return;
          case 'live': deps.highlight(w, r.sessionId); return;
          // `ready` used to start immediately. But every link reaching the gate
          // came from outside Argus (open-url / argv): any web page can fire
          // argus://run/<id> for a saved launcher — repeatedly, at a moment of
          // its choosing. Starting an agent therefore always takes a click on
          // the card; a ready launcher just has no "changed" warning on it.
          case 'changed':
          case 'ready':
            addCard(r.validated, 'run', r.launcher.id, r.launcher.label);
            return;
        }
      } finally {
        inFlightRuns.delete(link.launcherId);
      }
    },

    async request(validated, requester, signal) {
      if (signal?.aborted) return { ok: false, error: 'Cancelled' };
      // A trusted requester skips the card, but not a burst limit: past it,
      // a runaway orchestrator is back to asking.
      if (trusted.has(requester.sessionId) && mcpWithinBurst()) {
        const windowId = deps.targetWindow();
        try {
          const s = await deps.launch(validated, windowId, undefined, requester.sessionId);
          deps.toast(windowId, `Started ${validated.request.name ?? basename(validated.request.folder)} for ${requester.name}`, 'ok');
          return { ok: true, sessionId: s.id };
        } catch (err) {
          return { ok: false, error: errMsg(err) };
        }
      }
      const e = addCard(validated, 'mcp', undefined, undefined, requester);
      if (!e) return { ok: false, error: 'Too many launches are waiting for approval in Argus' };
      return new Promise<McpLaunchDecision>((resolve) => {
        e.waiters?.push(resolve);
        // The caller went away (Esc in the orchestrator, client timeout): withdraw
        // the card rather than let a later click start a session nobody hears of.
        signal?.addEventListener('abort', () => {
          if (entries.get(e.view.id) !== e || e.view.state === 'starting') return;
          entries.delete(e.view.id);
          settle(e, { ok: false, error: 'Cancelled' });
          deps.changed(e.windowId, 'updated');
        }, { once: true });
      });
    },

    list(windowId) {
      return [...entries.values()].filter((e) => e.windowId === windowId).map((e) => ({ ...e.view }));
    },

    async approve(id, saveAs, trustRequester) {
      const e = entries.get(id);
      if (!e) return { ok: false, error: 'No such pending launch' };
      if (e.view.state === 'expired') return { ok: false, error: 'This launch expired' };
      if (e.view.state === 'starting') return { ok: false, error: 'Already starting' };
      if (e.view.state === 'pending' && deps.now() - e.view.receivedAt > LIMITS.expiryMs) {
        e.view.state = 'expired'; settle(e, { ok: false, error: 'Nobody approved this launch in time' }); deps.changed(e.windowId, 'updated');
        return { ok: false, error: 'This launch expired' };
      }
      const isRun = e.view.source === 'run';
      if (trustRequester && !e.requester) return { ok: false, error: 'Only an MCP launch can be trusted' };
      if (saveAs && (isRun ? saveAs.id !== e.view.launcherId : !e.view.canSaveAsLauncher)) {
        return { ok: false, error: 'This launch can’t be saved as a launcher' };
      }
      e.view.state = 'starting'; e.view.error = undefined; deps.changed(e.windowId, 'updated');
      try {
        if (saveAs && e.savedAs !== saveAs.id) {
          const saved = await deps.saveLauncher({ id: saveAs.id, label: saveAs.label, validated: e.validated, overwrite: isRun ? true : saveAs.overwrite });
          if (!saved.ok) { e.view.state = 'pending'; e.view.error = saved.error; deps.changed(e.windowId, 'updated'); return saved; }
          e.savedAs = saveAs.id;
        }
        const launcherId = saveAs?.id ?? e.savedAs ?? e.view.launcherId;
        const s = await deps.launch(e.validated, e.windowId, launcherId, e.requester?.sessionId);
        if (trustRequester && e.requester) trusted.add(e.requester.sessionId);
        settle(e, { ok: true, sessionId: s.id });
        entries.delete(id);
        deps.changed(e.windowId, 'updated');
        deps.highlight(e.windowId, s.id);
        if (saveAs && !isRun) deps.toast(e.windowId, `Saved launcher run/${saveAs.id}`, 'ok');
        return { ok: true };
      } catch (err) {
        e.view.state = 'error'; e.view.error = errMsg(err); deps.changed(e.windowId, 'updated');
        // The waiting start_session call learns now; Retry stays on the card for the user.
        settle(e, { ok: false, error: `Launch failed: ${errMsg(err)}` });
        return { ok: false, error: errMsg(err) };
      }
    },

    discard(id) {
      const e = entries.get(id);
      if (!e) return;
      entries.delete(id);
      settle(e, { ok: false, error: 'The user discarded this launch in Argus' });
      deps.changed(e.windowId, 'updated');
    },

    tick() {
      const t = deps.now();
      for (const e of entries.values()) {
        if (e.view.state === 'pending' && t - e.view.receivedAt > LIMITS.expiryMs) {
          e.view.state = 'expired';
          settle(e, { ok: false, error: 'Nobody approved this launch in time' });
          deps.changed(e.windowId, 'updated');
        }
      }
    },

    has: (id) => entries.has(id),
    windowOf: (id) => entries.get(id)?.windowId,

    rehome(closed) {
      let moved = false;
      for (const e of entries.values()) if (e.windowId === closed) { e.windowId = 'main'; moved = true; }
      if (moved) deps.changed('main', 'updated');
    },
  };
}
