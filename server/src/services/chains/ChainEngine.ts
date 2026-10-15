import { randomUUID } from 'crypto';
import type { ChainFire, ChainFireOutcome, ChainMode, ChainTrigger, SessionChain, SessionStatus } from '@argus/shared';
import { CHAIN_GLOBAL_MAX_FIRES_PER_HOUR, CHAIN_MAX_FIRES_PER_HOUR, CHAIN_PROMPT_MAX } from '../../constants/chains.js';
import { SHELL_AGENT_ID } from '../../constants/agents.js';

/**
 * Beta F13 session chains: "when session A enters state S, send prompt P to
 * session B".
 *
 * The engine is a plain class with an injected clock and timers so every rule
 * below is unit-testable without fake global timers:
 *
 * - Edge-triggered: a chain fires on the transition INTO its trigger state,
 *   never again while the source stays there, and only after the source has
 *   held that state for CHAIN_DEBOUNCE_MS (a brief idle blip does nothing).
 * - `once` disarms after its fire; `repeat` stays armed.
 * - Loop protection: a chain that fires CHAIN_MAX_FIRES_PER_HOUR times within
 *   an hour disarms itself with a visible reason; all chains together fire at
 *   most CHAIN_GLOBAL_MAX_FIRES_PER_HOUR times per hour (extra fires dropped);
 *   and a chain that would close a cycle of repeat-mode chains is refused.
 * - Delivery goes through the shared SessionInputQueue (`write`), text then a
 *   delayed Enter, so the target reads keypresses, not a paste. A busy target
 *   (running, a menu on screen, input still pending, the user typing in it)
 *   queues the prompt for up to CHAIN_QUEUE_MAX_WAIT_MS, then drops it.
 *
 * With no chains and nothing queued, every hook returns after one check.
 */

export const CHAIN_DEBOUNCE_MS = 3_000;
export const CHAIN_QUEUE_MAX_WAIT_MS = 10 * 60_000;
export const CHAIN_AUDIT_MAX = 50;
/** Most chains that may exist at once. */
export const CHAIN_MAX_CHAINS = 50;
/** No delivery into a session the user typed into this recently. */
export const CHAIN_USER_QUIET_MS = 3_000;
/** After a send, the target counts as busy this long (it may not report running yet). */
export const CHAIN_TARGET_COOLDOWN_MS = 5_000;
/** Retry delay while the input queue still holds an Enter for the target. */
const INPUT_PENDING_RETRY_MS = 250;
const HOUR_MS = 3_600_000;

const TRIGGERS: ReadonlySet<string> = new Set<ChainTrigger>(['idle', 'waiting', 'done']);
const MODES: ReadonlySet<string> = new Set<ChainMode>(['once', 'repeat']);
/** Target states a prompt may be typed into. */
const DELIVERABLE: ReadonlySet<SessionStatus> = new Set<SessionStatus>(['idle', 'waiting', 'done']);
/** C0 controls and DEL (newlines included): a chain prompt is one typed line. */
const CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f]/;

/** What the engine needs to know about a session. */
export interface ChainSessionView {
  status: SessionStatus;
  agentType: string;
  name?: string;
  /** A menu (permission prompt, picker) is on screen: typing would answer it. */
  menuOpen?: boolean;
}

export type TimerHandle = unknown;

export interface ChainEngineDeps {
  isEnabled: () => boolean;
  store: { load(): Promise<SessionChain[]>; save(list: SessionChain[]): Promise<void> };
  session: (id: string) => ChainSessionView | undefined;
  /** Write through the shared SessionInputQueue (`pauseAfter` delays what follows). */
  write: (id: string, data: string, pauseAfter?: number) => void;
  /** The input queue still holds something (a broadcast's Enter) for this session. */
  inputPending?: (id: string) => boolean;
  enterDelayMs: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  newId?: () => string;
  /** Chains or the audit changed: tell clients to refetch. */
  onChange?: () => void;
}

export type ChainInput = { sourceId: string; targetId: string; trigger: ChainTrigger; mode: ChainMode; prompt: string };

interface PendingDelivery {
  chainId: string;
  sourceId: string;
  targetId: string;
  prompt: string;
  timer: TimerHandle;
}

export class ChainEngine {
  private chains: SessionChain[] = [];
  private lastStatus = new Map<string, SessionStatus>();
  private debounce = new Map<string, TimerHandle>();
  private chainFires = new Map<string, number[]>();
  private globalFires: number[] = [];
  private pending = new Map<string, PendingDelivery[]>();
  private retry = new Map<string, TimerHandle>();
  private lastUserInput = new Map<string, number>();
  private cooldownUntil = new Map<string, number>();
  private fires: ChainFire[] = [];
  private saving: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void>;
  private markReady!: () => void;

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly newId: () => string;

  constructor(private deps: ChainEngineDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; });
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.newId = deps.newId ?? randomUUID;
    this.readyPromise = new Promise((resolve) => { this.markReady = resolve; });
  }

  /** Load chains.json, dropping chains whose source or target no longer exists. */
  async init(sessionExists: (id: string) => boolean): Promise<void> {
    try {
      const loaded = await this.deps.store.load();
      this.chains = loaded.filter((c) => sessionExists(c.sourceId) && sessionExists(c.targetId));
      for (const c of this.chains) this.seedStatus(c.sourceId);
      if (this.chains.length !== loaded.length) this.persist();
    } finally {
      this.markReady();
    }
  }

  /** Resolves once init() has loaded the store. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  list(): SessionChain[] {
    return this.chains.map((c) => ({ ...c }));
  }

  audit(): ChainFire[] {
    return this.fires.map((f) => ({ ...f }));
  }

  /** Validate and add a chain. Every rule is enforced here, not in the client. */
  create(raw: unknown): { ok: true; chain: SessionChain } | { ok: false; error: string } {
    const v = this.validate(raw);
    if (!v.ok) return v;
    const input = v.value;
    if (input.mode === 'repeat' && this.closesRepeatCycle(input.sourceId, input.targetId)) {
      return { ok: false, error: 'This would close a loop of repeat chains (B already leads back to A). Use "once" or remove a chain first.' };
    }
    const chain: SessionChain = {
      id: this.newId(),
      ...input,
      armed: true,
      createdAt: new Date(this.now()).toISOString(),
      fireCount: 0,
    };
    this.chains.push(chain);
    // Edge semantics: a source already in the trigger state fires only after it leaves and comes back.
    this.seedStatus(chain.sourceId);
    this.changed();
    return { ok: true, chain: { ...chain } };
  }

  remove(id: string): boolean {
    const before = this.chains.length;
    this.chains = this.chains.filter((c) => c.id !== id);
    if (this.chains.length === before) return false;
    this.forgetChain(id);
    this.changed();
    return true;
  }

  /** Arm or disarm by hand. Re-arming clears the reason and the chain's hourly count. */
  setArmed(id: string, armed: boolean): SessionChain | undefined {
    const chain = this.chains.find((c) => c.id === id);
    if (!chain) return undefined;
    chain.armed = armed;
    if (armed) {
      delete chain.disarmedReason;
      this.chainFires.delete(id);
      this.seedStatus(chain.sourceId);
    } else {
      chain.disarmedReason = 'Disarmed by you';
      this.cancelDebounce(id);
    }
    this.changed();
    return { ...chain };
  }

  /** SessionManager status hook. Cheap: one check when there is nothing to do. */
  handleStatus(id: string, status: SessionStatus): void {
    if (this.chains.length === 0 && this.pending.size === 0) return;
    let isSource = false;
    for (const c of this.chains) if (c.sourceId === id) { isSource = true; break; }
    const prev = this.lastStatus.get(id);
    if (isSource) this.lastStatus.set(id, status);
    if (!this.deps.isEnabled()) {
      if (isSource) for (const c of this.chains) if (c.sourceId === id) this.cancelDebounce(c.id);
      if (this.pending.has(id)) this.dropAll(id, 'Session chains are switched off');
      return;
    }
    if (isSource && prev !== status) {
      for (const c of this.chains) {
        if (c.sourceId !== id) continue;
        if (status === c.trigger && c.armed) this.startDebounce(c);
        else this.cancelDebounce(c.id);
      }
    }
    if (status === 'exited') {
      if (this.pending.has(id)) this.dropAll(id, 'Target exited');
    } else if (this.pending.has(id)) {
      this.tryDeliver(id);
    }
  }

  /** The user typed into a session (socket session:input). Delivery waits for a quiet moment. */
  noteUserInput(id: string): void {
    if (this.chains.length === 0 && this.pending.size === 0) return;
    this.lastUserInput.set(id, this.now());
  }

  /** A session was deleted: every chain from or to it goes, and so does what was queued for it. */
  handleSessionRemoved(id: string): void {
    this.lastStatus.delete(id);
    this.lastUserInput.delete(id);
    this.cooldownUntil.delete(id);
    if (this.pending.has(id)) this.dropAll(id, 'Target was removed');
    const doomed = this.chains.filter((c) => c.sourceId === id || c.targetId === id);
    if (doomed.length === 0) return;
    this.chains = this.chains.filter((c) => c.sourceId !== id && c.targetId !== id);
    for (const c of doomed) this.forgetChain(c.id);
    this.changed();
  }

  /** Chain counts per source session (the tile indicator). */
  countsBySource(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.chains) out[c.sourceId] = (out[c.sourceId] ?? 0) + 1;
    return out;
  }

  dispose(): void {
    for (const t of this.debounce.values()) this.clearTimer(t);
    for (const t of this.retry.values()) this.clearTimer(t);
    for (const q of this.pending.values()) for (const p of q) this.clearTimer(p.timer);
    this.debounce.clear();
    this.retry.clear();
    this.pending.clear();
  }

  /** Wait for in-flight saves (tests, shutdown). */
  flush(): Promise<void> {
    return this.saving;
  }

  // ── validation ────────────────────────────────────────────────────────────

  validate(raw: unknown): { ok: true; value: ChainInput } | { ok: false; error: string } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Invalid request' };
    const { sourceId, targetId, trigger, mode, prompt } = raw as Record<string, unknown>;
    if (typeof sourceId !== 'string' || !sourceId) return { ok: false, error: 'sourceId is required' };
    if (typeof targetId !== 'string' || !targetId) return { ok: false, error: 'targetId is required' };
    if (sourceId === targetId) return { ok: false, error: 'A chain cannot target its own session' };
    if (typeof trigger !== 'string' || !TRIGGERS.has(trigger)) return { ok: false, error: 'trigger must be idle, waiting or done' };
    if (mode !== undefined && (typeof mode !== 'string' || !MODES.has(mode))) return { ok: false, error: 'mode must be once or repeat' };
    if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, error: 'Prompt is required' };
    if (prompt.length > CHAIN_PROMPT_MAX) return { ok: false, error: `Prompt is longer than ${CHAIN_PROMPT_MAX} characters` };
    if (CONTROL_CHARS.test(prompt)) return { ok: false, error: 'Prompt must be a single line without control characters' };
    const source = this.deps.session(sourceId);
    if (!source) return { ok: false, error: 'Unknown source session' };
    if (source.status === 'exited') return { ok: false, error: 'The source session has exited' };
    const target = this.deps.session(targetId);
    if (!target) return { ok: false, error: 'Unknown target session' };
    if (target.status === 'exited') return { ok: false, error: 'The target session has exited' };
    if (target.agentType === SHELL_AGENT_ID) return { ok: false, error: 'The target must be an agent session, not a plain shell' };
    if (this.chains.length >= CHAIN_MAX_CHAINS) return { ok: false, error: `At most ${CHAIN_MAX_CHAINS} chains` };
    return {
      ok: true,
      value: { sourceId, targetId, trigger: trigger as ChainTrigger, mode: (mode as ChainMode | undefined) ?? 'once', prompt },
    };
  }

  /** Would a repeat edge source→target close a cycle among repeat chains? (target reaches source) */
  private closesRepeatCycle(sourceId: string, targetId: string): boolean {
    const edges = new Map<string, string[]>();
    for (const c of this.chains) {
      if (c.mode !== 'repeat') continue;
      const list = edges.get(c.sourceId) ?? [];
      list.push(c.targetId);
      edges.set(c.sourceId, list);
    }
    const seen = new Set<string>();
    const stack = [targetId];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === sourceId) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of edges.get(node) ?? []) stack.push(next);
    }
    return false;
  }

  // ── trigger ───────────────────────────────────────────────────────────────

  private seedStatus(sessionId: string): void {
    const s = this.deps.session(sessionId);
    if (s) this.lastStatus.set(sessionId, s.status);
  }

  private startDebounce(chain: SessionChain): void {
    if (this.debounce.has(chain.id)) return;
    const id = chain.id;
    this.debounce.set(id, this.setTimer(() => {
      this.debounce.delete(id);
      this.onDebounced(id);
    }, CHAIN_DEBOUNCE_MS));
  }

  private cancelDebounce(chainId: string): void {
    const t = this.debounce.get(chainId);
    if (t === undefined) return;
    this.clearTimer(t);
    this.debounce.delete(chainId);
  }

  private onDebounced(chainId: string): void {
    const chain = this.chains.find((c) => c.id === chainId);
    if (!chain || !chain.armed || !this.deps.isEnabled()) return;
    if (this.deps.session(chain.sourceId)?.status !== chain.trigger) return;
    this.fire(chain);
  }

  private fire(chain: SessionChain): void {
    const t = this.now();
    this.globalFires = this.globalFires.filter((x) => t - x < HOUR_MS);
    if (this.globalFires.length >= CHAIN_GLOBAL_MAX_FIRES_PER_HOUR) {
      this.record(chain, 'dropped', `Global limit: ${CHAIN_GLOBAL_MAX_FIRES_PER_HOUR} chain fires per hour`);
      this.notify();
      return;
    }
    const mine = (this.chainFires.get(chain.id) ?? []).filter((x) => t - x < HOUR_MS);
    mine.push(t);
    this.chainFires.set(chain.id, mine);
    this.globalFires.push(t);
    chain.fireCount += 1;
    chain.lastFiredAt = new Date(t).toISOString();
    if (chain.mode === 'once') {
      chain.armed = false;
      chain.disarmedReason = 'Fired once';
    } else if (mine.length >= CHAIN_MAX_FIRES_PER_HOUR) {
      chain.armed = false;
      chain.disarmedReason = `Fired ${CHAIN_MAX_FIRES_PER_HOUR} times within an hour; disarmed to stop a loop`;
    }
    this.deliver(chain);
    this.changed();
  }

  // ── delivery ──────────────────────────────────────────────────────────────

  private deliver(chain: SessionChain): void {
    const target = this.deps.session(chain.targetId);
    if (!target) { this.record(chain, 'dropped', 'Target no longer exists'); return; }
    if (target.status === 'exited') { this.record(chain, 'dropped', 'Target has exited'); return; }
    const block = this.pending.has(chain.targetId) ? { reason: 'Earlier prompts are queued for the target' } : this.blockReason(chain.targetId, target);
    if (!block) {
      this.send(chain.targetId, chain.prompt);
      this.record(chain, 'sent');
      return;
    }
    const item: PendingDelivery = { chainId: chain.id, sourceId: chain.sourceId, targetId: chain.targetId, prompt: chain.prompt, timer: undefined };
    item.timer = this.setTimer(() => this.expire(item), CHAIN_QUEUE_MAX_WAIT_MS);
    const q = this.pending.get(chain.targetId) ?? [];
    q.push(item);
    this.pending.set(chain.targetId, q);
    this.record(chain, 'queued', block.reason);
    if (block.retryAt !== undefined) this.scheduleRetry(chain.targetId, block.retryAt);
  }

  /** Why the target cannot take a prompt right now; `retryAt` when only time will tell. */
  private blockReason(targetId: string, target: ChainSessionView): { reason: string; retryAt?: number } | null {
    const t = this.now();
    if (!DELIVERABLE.has(target.status)) return { reason: 'Target is busy' };
    if (target.menuOpen) return { reason: 'Target is showing a menu' };
    if (this.deps.inputPending?.(targetId)) return { reason: 'Target input is pending', retryAt: t + INPUT_PENDING_RETRY_MS };
    const typed = this.lastUserInput.get(targetId);
    if (typed !== undefined && t - typed < CHAIN_USER_QUIET_MS) return { reason: 'You are typing in the target', retryAt: typed + CHAIN_USER_QUIET_MS };
    const cool = this.cooldownUntil.get(targetId);
    if (cool !== undefined && t < cool) return { reason: 'Target just received a prompt', retryAt: cool };
    return null;
  }

  private tryDeliver(targetId: string): void {
    const q = this.pending.get(targetId);
    if (!q || q.length === 0) return;
    if (!this.deps.isEnabled()) { this.dropAll(targetId, 'Session chains are switched off'); return; }
    const target = this.deps.session(targetId);
    if (!target) { this.dropAll(targetId, 'Target no longer exists'); return; }
    if (target.status === 'exited') { this.dropAll(targetId, 'Target exited'); return; }
    const block = this.blockReason(targetId, target);
    if (block) {
      if (block.retryAt !== undefined) this.scheduleRetry(targetId, block.retryAt);
      return;
    }
    const item = q.shift()!;
    this.clearTimer(item.timer);
    if (q.length === 0) this.pending.delete(targetId);
    this.send(targetId, item.prompt);
    this.recordItem(item, 'sent', 'Delivered after waiting');
    // The next queued prompt waits for the target to settle again.
    if (q.length > 0) this.scheduleRetry(targetId, this.cooldownUntil.get(targetId) ?? this.now());
    this.notify();
  }

  private send(targetId: string, prompt: string): void {
    // Text, a short pause, then Enter as its own keypress — exactly what broadcast does.
    this.deps.write(targetId, prompt, this.deps.enterDelayMs);
    this.deps.write(targetId, '\r');
    this.cooldownUntil.set(targetId, this.now() + CHAIN_TARGET_COOLDOWN_MS);
  }

  private scheduleRetry(targetId: string, at: number): void {
    const existing = this.retry.get(targetId);
    if (existing !== undefined) this.clearTimer(existing);
    this.retry.set(targetId, this.setTimer(() => {
      this.retry.delete(targetId);
      this.tryDeliver(targetId);
    }, Math.max(0, at - this.now())));
  }

  private expire(item: PendingDelivery): void {
    const q = this.pending.get(item.targetId);
    if (!q) return;
    const i = q.indexOf(item);
    if (i < 0) return;
    q.splice(i, 1);
    if (q.length === 0) this.clearPending(item.targetId);
    this.recordItem(item, 'dropped', `Target stayed busy for ${CHAIN_QUEUE_MAX_WAIT_MS / 60_000} minutes`);
    this.notify();
  }

  private dropAll(targetId: string, reason: string): void {
    const q = this.pending.get(targetId) ?? [];
    this.clearPending(targetId);
    for (const item of q) {
      this.clearTimer(item.timer);
      this.recordItem(item, 'dropped', reason);
    }
    if (q.length > 0) this.notify();
  }

  private clearPending(targetId: string): void {
    this.pending.delete(targetId);
    const r = this.retry.get(targetId);
    if (r !== undefined) { this.clearTimer(r); this.retry.delete(targetId); }
  }

  // ── bookkeeping ───────────────────────────────────────────────────────────

  private forgetChain(chainId: string): void {
    this.cancelDebounce(chainId);
    this.chainFires.delete(chainId);
  }

  private record(chain: SessionChain, outcome: ChainFireOutcome, reason?: string): void {
    this.recordItem({ chainId: chain.id, sourceId: chain.sourceId, targetId: chain.targetId }, outcome, reason);
  }

  private recordItem(item: { chainId: string; sourceId: string; targetId: string }, outcome: ChainFireOutcome, reason?: string): void {
    const sourceName = this.deps.session(item.sourceId)?.name;
    const targetName = this.deps.session(item.targetId)?.name;
    this.fires.unshift({
      at: new Date(this.now()).toISOString(),
      chainId: item.chainId,
      sourceId: item.sourceId,
      targetId: item.targetId,
      ...(sourceName !== undefined ? { sourceName } : {}),
      ...(targetName !== undefined ? { targetName } : {}),
      outcome,
      ...(reason !== undefined ? { reason } : {}),
    });
    if (this.fires.length > CHAIN_AUDIT_MAX) this.fires.length = CHAIN_AUDIT_MAX;
  }

  private changed(): void {
    this.persist();
    this.notify();
  }

  private notify(): void {
    try {
      this.deps.onChange?.();
    } catch (err) {
      console.error('[chains] onChange threw:', err);
    }
  }

  private persist(): void {
    const snapshot = this.list();
    this.saving = this.saving
      .then(() => this.deps.store.save(snapshot))
      .catch((err) => console.error('[chains] save failed:', err));
  }
}
