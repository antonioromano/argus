# Direct Run Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user create agent sessions in a **direct** run mode — spawned by the server with plain node-pty like the ⌘T shell (no daemon, no tmux), stopping when Argus quits, restored after a restart as an `exited` placeholder with Restart.

**Architecture:** A new `DirectBackend` implements the existing `PtyBackend` interface on top of `PtyManager.spawn` (the no-tmux path). `SessionManager` keeps its app-wide backend (`this.backend`, daemon/tmux) and adds `this.directBackend`; a private `backendFor(session)` routes every per-session call by the session's persisted `runMode`. Restore registers direct sessions with an `InertPty` stub and status `exited`. Quit gains a pure `quitPolicy` function deciding which confirmation to show.

**Tech Stack:** TypeScript (ESM, strict), Express/Socket.io server (node:test), Electron main (node:test), React renderer (Vitest), node-pty.

**Spec:** `docs/superpowers/specs/2026-09-28-direct-run-mode-design.md` (decisions D1–D5 there are binding).

## Global Constraints

- `runMode: 'persistent' | 'direct'`; missing ⇒ `'persistent'`; fixed at creation (D5).
- `defaultRunMode` default `'persistent'` (D4); `confirmQuitDirectSessions` default `true` (D3).
- Direct sessions are never reattached; after a restart they are `exited` placeholders with all metadata kept and are never auto-spawned (D2).
- ⌘Q with a running direct session asks first, listing only direct sessions, with "Don't ask again"; the existing stop-all confirmation keeps precedence (D3).
- Server and `electron/` code may only `import type` from `@argus/shared`; `DEFAULT_CONFIG` exists in `shared/src/types.ts` AND `server/src/persistence/ConfigStore.ts` and `check:deps` keeps them in sync.
- Node for all npm commands: `export PATH=~/.nvm/versions/node/v24.16.0/bin:$PATH`.
- Gate: `npm run verify` before every commit.
- Commit messages: conventional commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests assert outcomes (what was spawned/killed, what the user sees), not flag values alone.

## Review Focus

1. **A direct session restored as a placeholder receives input or a resize** (the tile is still mounted) — nothing throws, nothing is written anywhere. Test in Task 4 (`input and resize to a restored placeholder are harmless`).
2. **Restart of a placeholder** must spawn through the direct backend, not the daemon. Test in Task 4.
3. **"Quit & Stop All" with direct sessions present** — direct agents are killed too, and the new dialog does not appear on top of the explicit stop-all. Tests in Tasks 3 and 5.
4. **Old `sessions.json` without `runMode`** restores exactly as today (persistent). Test in Task 4.
5. **Clone of a direct session** defaults to direct in the Clone sheet. Test in Task 6.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `shared/src/types.ts` | Modify | `RunMode`; `SessionInfo.runMode`; `CreateSessionRequest.runMode`; `AppConfig.defaultRunMode`, `confirmQuitDirectSessions`; `DEFAULT_CONFIG` |
| `server/src/persistence/ConfigStore.ts` | Modify | server copy of `DEFAULT_CONFIG` |
| `server/src/routes/config.ts` (+ test) | Modify | validate the two new keys |
| `server/src/persistence/SessionStore.ts` | Modify | `PersistedSession.runMode` |
| `server/src/services/ptyBackend/DirectBackend.ts` (+ test) | Create | direct spawn/kill backend |
| `server/src/services/ptyBackend/InertPty.ts` | Create | no-op `IPty` for exited placeholders |
| `server/src/services/ptyBackend/types.ts` | Modify | `kind` union adds `'direct'` |
| `server/src/services/SessionManager.ts` (+ new `SessionManager.runMode.test.ts`) | Modify | `runMode` field, `backendFor`, create/restart/destroy/wheel/shutdown/stopAll routing, restore placeholders, persistence |
| `server/src/routes/sessions.ts` | Modify | pass `runMode` to `createSession` |
| `server/src/index.ts` | Modify | summaries carry `runMode`; getter/setter for `confirmQuitDirectSessions` |
| `electron/src/quitPolicy.ts` (+ test) | Create | pure decision: which quit confirmation |
| `electron/src/main.ts` | Modify | use `quitPolicy`; direct-session dialog |
| `client/src/app/ui/RunModeChoice.tsx` | Create | Persistent / Direct segmented choice |
| `client/src/app/overlays/CreateSheet.tsx`, `CloneSheet.tsx`, `client/src/app/types.ts`, `client/src/app/ArgusApp.tsx`, `client/src/hooks/useSessions.ts` | Modify | carry `runMode` from sheet to API |
| `client/src/app/overlays/settings/panes/RuntimePane.tsx`, `ConfirmationsPane.tsx`, `settings/registry.ts` | Modify | settings UI + registry |
| `client/src/app/views/Mosaic.tsx`, `client/src/app/views/Focus.tsx` | Modify | "Direct" marker |

---

### Task 1: Shared types and config keys

**Files:**
- Modify: `shared/src/types.ts`, `server/src/persistence/ConfigStore.ts`, `server/src/routes/config.ts`
- Test: `server/src/routes/config.test.ts`

**Interfaces:**
- Produces: `export type RunMode = 'persistent' | 'direct';` in `@argus/shared`; `SessionInfo.runMode?: RunMode`; `CreateSessionRequest.runMode?: RunMode`; `AppConfig.defaultRunMode?: RunMode`; `AppConfig.confirmQuitDirectSessions?: boolean`; `DEFAULT_CONFIG.defaultRunMode = 'persistent'`, `DEFAULT_CONFIG.confirmQuitDirectSessions = true`.

- [ ] **Step 1: Add the values to the config round-trip test**

In `server/src/routes/config.test.ts`, in the `nonDefault` object of the round-trip test (the one that cross-checks `DEFAULT_CONFIG` keys), add after `defaultTerminalEngine: 'native',`:

```ts
    defaultRunMode: 'direct',
    confirmQuitDirectSessions: false,
```

and append a validation test:

```ts
test('PUT /api/config rejects an unknown defaultRunMode and keeps the current value', async () => {
  await put({ defaultRunMode: 'direct' });
  const { body } = await put({ defaultRunMode: 'sometimes' });
  assert.equal((body as Record<string, unknown>).defaultRunMode, 'direct');
});
```

(Use the file's existing `put`/`get` helpers; if the round-trip test builds its server per test, follow the same setup for the new test.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- --test-name-pattern "config"`
Expected: FAIL — the round-trip test reports `defaultRunMode`/`confirmQuitDirectSessions` dropped (and TS errors until the types exist).

- [ ] **Step 3: Implement**

`shared/src/types.ts` — next to `TerminalEngine`:

```ts
/** How a session's agent process is hosted. `persistent` lives in the argusd
 *  daemon (or tmux) and survives an Argus quit; `direct` is spawned by the
 *  server with plain node-pty, like the ⌘T shell, and stops when Argus quits. */
export type RunMode = 'persistent' | 'direct';
```

`SessionInfo`: after `terminalEngine?`:

```ts
  /** How the agent is hosted. Missing ⇒ 'persistent' (sessions created before run modes). */
  runMode?: RunMode;
```

`CreateSessionRequest`: add `runMode?: RunMode;`.

`AppConfig`: after `defaultTerminalEngine?`:

```ts
  // Run mode for new sessions when the Create sheet doesn't override it.
  defaultRunMode?: RunMode;
  // Ask before ⌘Q stops running direct sessions.
  confirmQuitDirectSessions?: boolean;
```

`DEFAULT_CONFIG` (shared) and the server copy in `ConfigStore.ts`, after `defaultTerminalEngine: 'web',`:

```ts
  defaultRunMode: 'persistent',
  confirmQuitDirectSessions: true,
```

`server/src/routes/config.ts`: add `defaultRunMode, confirmQuitDirectSessions` to the destructuring on the `req.body` line, and to `updated` after `defaultTerminalEngine`:

```ts
      defaultRunMode: (defaultRunMode === 'persistent' || defaultRunMode === 'direct')
        ? defaultRunMode
        : current.defaultRunMode,
      confirmQuitDirectSessions: confirmQuitDirectSessions !== undefined
        ? !!confirmQuitDirectSessions
        : current.confirmQuitDirectSessions,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run check:deps && npm test -w server -- --test-name-pattern "config"`
Expected: PASS; check:deps prints the objects in sync.

- [ ] **Step 5: Commit**

```bash
git add shared/src/types.ts server/src/persistence/ConfigStore.ts server/src/routes/config.ts server/src/routes/config.test.ts
git commit -m "$(cat <<'EOF'
feat(config): add run mode types and the direct-session settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `DirectBackend` and `InertPty`

**Files:**
- Create: `server/src/services/ptyBackend/DirectBackend.ts`, `server/src/services/ptyBackend/InertPty.ts`, `server/src/services/ptyBackend/DirectBackend.test.ts`
- Modify: `server/src/services/ptyBackend/types.ts:~20` (`readonly kind: 'tmux' | 'daemon' | 'direct';`)

**Interfaces:**
- Consumes: `PtyManager.spawn(folderPath, command, cols, rows, flags, extraEnv): IPty`.
- Produces: `class DirectBackend implements PtyBackend` with `constructor(pty: Pick<PtyManager, 'spawn'>)`; `class InertPty implements IPty` with `constructor(cols: number, rows: number)`.

- [ ] **Step 1: Write the failing tests**

`server/src/services/ptyBackend/DirectBackend.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DirectBackend } from './DirectBackend.js';
import { InertPty } from './InertPty.js';

function fakePty() {
  const writes: string[] = [];
  let killed = 0;
  const p = {
    pid: 1, cols: 80, rows: 24, process: 'claude', handleFlowControl: false,
    onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
    write: (d: string) => { writes.push(d); }, resize() {}, clear() {},
    kill: () => { killed++; }, pause() {}, resume() {},
  };
  return { p: p as any, writes, killedCount: () => killed };
}

function harness() {
  const spawned: any[] = [];
  const ptys: ReturnType<typeof fakePty>[] = [];
  const mgr = {
    spawn: (...args: any[]) => { spawned.push(args); const f = fakePty(); ptys.push(f); return f.p; },
  };
  return { backend: new DirectBackend(mgr as any), spawned, ptys };
}

const opts = (sessionId: string) => ({
  sessionId, folderPath: '/tmp/x', command: 'claude', cols: 100, rows: 30,
  flags: ['--x'], extraEnv: { A: '1' }, attachExisting: false,
});

test('spawns through the plain no-tmux path with the session\'s folder, command, grid, flags and env', () => {
  const { backend, spawned } = harness();
  backend.spawn(opts('s1'));
  assert.deepEqual(spawned, [['/tmp/x', 'claude', 100, 30, ['--x'], { A: '1' }]]);
});

test('is not persistent and never reports survivors', async () => {
  const { backend } = harness();
  assert.equal(backend.kind, 'direct');
  assert.equal(backend.isPersistent(), false);
  assert.deepEqual([...(await backend.listSurvivors())], []);
  assert.equal(backend.isSurvivorDead('s1'), true);
});

test('detach kills the agent — a direct agent cannot outlive its client', () => {
  const { backend, ptys } = harness();
  const p = backend.spawn(opts('s1'));
  backend.detach(p);
  assert.equal(ptys[0].killedCount(), 1);
});

test('stopSession and stopAll kill the tracked agents', () => {
  const { backend, ptys } = harness();
  backend.spawn(opts('s1'));
  backend.spawn(opts('s2'));
  backend.stopSession('s1');
  assert.equal(ptys[0].killedCount(), 1);
  assert.equal(ptys[1].killedCount(), 0);
  backend.stopAll();
  assert.equal(ptys[1].killedCount(), 1);
});

test('a wheel report is a plain write to the agent', () => {
  const { backend, ptys } = harness();
  const p = backend.spawn(opts('s1'));
  backend.writeWheel('s1', p, '\x1b[<64;1;1M');
  assert.deepEqual(ptys[0].writes, ['\x1b[<64;1;1M']);
});

test('an InertPty accepts every call and never emits', () => {
  const p = new InertPty(80, 24);
  let events = 0;
  p.onData(() => { events++; });
  p.onExit(() => { events++; });
  assert.doesNotThrow(() => { p.write('x'); p.resize(100, 30); p.kill(); p.pause(); p.resume(); p.clear(); });
  assert.equal(events, 0);
  assert.equal(p.cols, 100);
  assert.equal(p.rows, 30);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- --test-name-pattern "DirectBackend|InertPty|direct agent|plain no-tmux"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`server/src/services/ptyBackend/InertPty.ts`:

```ts
import type { IPty, IDisposable } from 'node-pty';

/**
 * The pty of an exited direct session restored after an Argus restart: there
 * is no process behind it (direct agents never survive a quit), but the rest of
 * SessionManager treats every session as having a pty. Every call is accepted
 * and ignored; it never emits data or exit. Restart replaces it with a real one.
 */
export class InertPty implements IPty {
  readonly pid = 0;
  readonly process = '';
  handleFlowControl = false;
  cols: number;
  rows: number;
  private static readonly noop: IDisposable = { dispose() {} };

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  onData(): IDisposable { return InertPty.noop; }
  onExit(): IDisposable { return InertPty.noop; }
  write(): void {}
  resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; }
  clear(): void {}
  kill(): void {}
  pause(): void {}
  resume(): void {}
}
```

If `IPty` in the installed node-pty declares members this class lacks (the compiler will say), add them as no-ops with the declared signatures.

`server/src/services/ptyBackend/DirectBackend.ts`:

```ts
import type { IPty } from 'node-pty';
import type { PtyManager } from '../PtyManager.js';
import type { TerminalMirror } from '../TerminalMirror.js';
import type { PtyBackend, SpawnOpts } from './types.js';

/**
 * Direct run mode: the agent is spawned with plain node-pty — `$SHELL -l -c
 * "exec <agent>"` in the session folder, the same path the ⌘T shell and the
 * tmux-unavailable fallback use. Nothing sits between the agent and the
 * terminal, and nothing survives an Argus quit: detach kills, there are never
 * survivors to reattach, and restore brings the session back as an exited
 * placeholder (see SessionManager.restoreSessions).
 */
export class DirectBackend implements PtyBackend {
  readonly kind = 'direct' as const;
  private readonly ptys = new Map<string, IPty>();

  constructor(private readonly pty: Pick<PtyManager, 'spawn'>) {}

  isPersistent(): boolean { return false; }

  spawn(o: SpawnOpts): IPty {
    // attachExisting never applies: there is nothing to attach to.
    const p = this.pty.spawn(o.folderPath, o.command, o.cols, o.rows, o.flags, o.extraEnv);
    this.ptys.set(o.sessionId, p);
    return p;
  }

  seedMirror(_sessionId: string, _mirror: TerminalMirror): void {
    // The mirror is fed by the raw stream; there is no pre-attach history.
  }

  writeWheel(_sessionId: string, pty: IPty, data: string): void {
    pty.write(data); // no multiplexer in the way
  }

  detach(pty: IPty): void {
    try { pty.kill(); } catch { /* already gone */ }
    for (const [id, p] of this.ptys) if (p === pty) this.ptys.delete(id);
  }

  stopSession(sessionId: string): void {
    const p = this.ptys.get(sessionId);
    this.ptys.delete(sessionId);
    try { p?.kill(); } catch { /* already gone */ }
  }

  stopAll(): void {
    for (const id of [...this.ptys.keys()]) this.stopSession(id);
  }

  async listSurvivors(): Promise<Set<string>> { return new Set(); }
  isSurvivorDead(_sessionId: string): boolean { return true; }
  async reapOrphans(_knownIds: Set<string>): Promise<void> {}
}
```

`types.ts`: `readonly kind: 'tmux' | 'daemon' | 'direct';`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/ptyBackend
git commit -m "$(cat <<'EOF'
feat(server): add a direct pty backend and an inert pty for exited placeholders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Per-session routing in `SessionManager`

**Files:**
- Modify: `server/src/services/SessionManager.ts`, `server/src/persistence/SessionStore.ts`, `server/src/routes/sessions.ts`
- Create test: `server/src/services/SessionManager.runMode.test.ts`

**Interfaces:**
- Consumes: `DirectBackend` (Task 2), `RunMode` (Task 1).
- Produces: `ManagedSession.runMode: RunMode`; `PersistedSession.runMode?: RunMode`; `createSession(..., terminalEngine?: TerminalEngine, runMode?: RunMode, restoreExited = false)` (two new trailing params; `restoreExited` is used by Task 4); private `backendFor(s: { runMode?: RunMode }): PtyBackend`; private `normalizeRunMode(v: unknown, fallback: RunMode): RunMode`.

- [ ] **Step 1: Write the failing tests**

`server/src/services/SessionManager.runMode.test.ts` — drive routing with fake backends injected on the instance (the pattern `SessionManager.engine.test.ts` uses for internals):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

const cfg = (defaultRunMode?: 'persistent' | 'direct') => ({
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {}, ...(defaultRunMode ? { defaultRunMode } : {}) }),
  save: async () => {},
}) as any;

function fakeBackend(kind: string, persistent: boolean) {
  const log: string[] = [];
  const pty = () => ({
    pid: 1, cols: 120, rows: 30, process: 'x', handleFlowControl: false,
    onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
    write: (d: string) => log.push(`write:${d}`), resize() {}, clear() {}, kill() {}, pause() {}, resume() {},
  });
  return {
    log,
    b: {
      kind, isPersistent: () => persistent,
      spawn: (o: any) => { log.push(`spawn:${o.sessionId}`); return pty(); },
      seedMirror: () => {}, writeWheel: (id: string) => log.push(`wheel:${id}`),
      detach: () => log.push('detach'), stopSession: (id: string) => log.push(`stop:${id}`),
      stopAll: () => log.push('stopAll'), listSurvivors: async () => new Set<string>(),
      isSurvivorDead: () => true, reapOrphans: async () => {},
    },
  };
}

function withBackends(defaultRunMode?: 'persistent' | 'direct') {
  const sm = new SessionManager(os.tmpdir(), cfg(defaultRunMode));
  const persistent = fakeBackend('daemon', true);
  const direct = fakeBackend('direct', false);
  (sm as any).backend = persistent.b;
  (sm as any).directBackend = direct.b;
  (sm as any).persistSessions = async () => {};
  (sm as any).fileWatcher = { watch() {}, stop: async () => {}, stopAll: async () => {} };
  return { sm, persistent, direct };
}

test('a direct session spawns through the direct backend, a persistent one through the app backend', async () => {
  const { sm, persistent, direct } = withBackends();
  const d = await sm.createSession(os.tmpdir(), 'd', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'direct');
  const p = await sm.createSession(os.tmpdir(), 'p', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'persistent');
  assert.equal(d.runMode, 'direct');
  assert.equal(p.runMode, 'persistent');
  assert.deepEqual(direct.log, [`spawn:${d.id}`]);
  assert.deepEqual(persistent.log, [`spawn:${p.id}`]);
});

test('with no run mode given, the config default decides', async () => {
  const { sm, direct } = withBackends('direct');
  const s = await sm.createSession(os.tmpdir(), 's', 'claude', []);
  assert.equal(s.runMode, 'direct');
  assert.deepEqual(direct.log, [`spawn:${s.id}`]);
});

test('an unknown run mode falls back to the config default', async () => {
  const { sm } = withBackends();
  const s = await sm.createSession(os.tmpdir(), 's', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'sometimes' as any);
  assert.equal(s.runMode, 'persistent');
});

test('destroy, wheel and restart each go through the session\'s own backend', async () => {
  const { sm, persistent, direct } = withBackends();
  const d = await sm.createSession(os.tmpdir(), 'd', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'direct');
  direct.log.length = 0;
  sm.writeToSession(d.id, '\x1b[<64;1;1M');
  await sm.restartSession(d.id);
  await sm.destroySession(d.id);
  assert.ok(direct.log.includes(`wheel:${d.id}`), direct.log.join(','));
  assert.ok(direct.log.includes(`spawn:${d.id}`), direct.log.join(','));
  assert.ok(direct.log.includes(`stop:${d.id}`), direct.log.join(','));
  assert.deepEqual(persistent.log, []);
});

test('Quit & Stop All stops direct agents as well as persistent ones', async () => {
  const { sm, persistent, direct } = withBackends();
  await sm.createSession(os.tmpdir(), 'd', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'direct');
  await sm.stopAllAndShutdown();
  assert.ok(persistent.log.includes('stopAll'));
  assert.ok(direct.log.includes('stopAll'));
});

test('a plain quit detaches every session through its own backend (direct agents die, persistent survive)', async () => {
  const { sm, persistent, direct } = withBackends();
  await sm.createSession(os.tmpdir(), 'd', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'direct');
  await sm.createSession(os.tmpdir(), 'p', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'persistent');
  direct.log.length = 0; persistent.log.length = 0;
  await sm.shutdown();
  assert.deepEqual(direct.log, ['detach']);
  assert.deepEqual(persistent.log, ['detach']);
});

test('runMode is persisted', async () => {
  const { sm } = withBackends();
  let saved: any[] = [];
  (sm as any).store = { save: async (d: any[]) => { saved = d; }, load: async () => [] };
  delete (sm as any).persistSessions; // use the real one against the fake store
  await sm.createSession(os.tmpdir(), 'd', 'claude', [], undefined, undefined, undefined, undefined, false, undefined, 'direct');
  assert.equal(saved[0].runMode, 'direct');
});
```

If `createSession` needs more stubbing to run under test (agent registry resolution of `claude`, signal injection writing files under `os.tmpdir()`), stub the minimum on the instance (e.g. `(sm as any).buildSignalInjection = () => null`) and note it in the report.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- --test-name-pattern "direct|run mode|Quit & Stop All|plain quit|runMode"`
Expected: FAIL (no `directBackend`, no `runMode`).

- [ ] **Step 3: Implement**

`SessionStore.ts`: import `RunMode` type; add `runMode?: RunMode;` to `PersistedSession`.

`SessionManager.ts`:

1. Imports: `import { DirectBackend } from './ptyBackend/DirectBackend.js';` and add `RunMode` to the `@argus/shared` type import.
2. `ManagedSession`: add `/** How the agent is hosted; fixed at creation (spec D5). */ runMode: RunMode;`
3. Fields: `private directBackend: PtyBackend;` initialised in the constructor right after `this.backend = makePtyBackend(...)`: `this.directBackend = new DirectBackend(this.ptyManager);`
4. Helpers near `normalizeTerminalEngine`:

```ts
  /** The backend hosting this session's agent: direct sessions bypass the
   *  daemon/tmux; everything else uses the app-wide persistent backend. */
  private backendFor(s: { runMode?: RunMode }): PtyBackend {
    return s.runMode === 'direct' ? this.directBackend : this.backend;
  }

  private normalizeRunMode(value: unknown, fallback: RunMode): RunMode {
    return value === 'persistent' || value === 'direct' ? value : fallback;
  }
```

5. `createSession` signature: append `runMode?: RunMode, restoreExited = false` after `terminalEngine?: TerminalEngine`. Near the start, after the config is loaded (the method already loads it to resolve the agent), resolve:

```ts
    const resolvedRunMode = this.normalizeRunMode(runMode, config.defaultRunMode ?? 'persistent');
    const backend = this.backendFor({ runMode: resolvedRunMode });
```

   Replace the uses of `this.backend` inside `createSession` with `backend` (`isPersistent()`, `kind`, `ready`, `spawn`, `seedMirror`). Add `runMode: resolvedRunMode,` to the `ManagedSession` literal. (`restoreExited` is consumed in Task 4; leave it unused here.)
6. `toSessionInfo`: add `runMode: session.runMode,`. `persistSessions`: add `runMode: s.runMode,`.
7. Per-session call sites → `this.backendFor(session)`: `destroySession` (`detach`, `stopSession`), `restartSession` (`detach`, `stopSessionAndWait`/`stopSession`, `ready`, `spawn`), `writeToSession`'s `writeWheel`, `shutdown`'s per-session `detach`.
8. `stopAllAndShutdown`: `this.backend.stopAll(); this.directBackend.stopAll(); await this.shutdown();`
9. `restoreSessions` passes `p.runMode` through to `createSession` (Task 4 adds the placeholder branch): `..., attach, p.terminalEngine, p.runMode ?? 'persistent')`.

`server/src/routes/sessions.ts`: destructure `runMode` from the body and pass it: `manager.createSession(folderPath, name, agentType, flags, undefined, undefined, worktreeBranch, worktreeBase, undefined, terminalEngine, runMode)`.

Afterwards `grep -n "this\.backend\." server/src/services/SessionManager.ts` must show only app-wide uses (constructor/`configureBackend`/`wireBackend`, `isPersistent` accessor, restore's `ready`/`listSurvivors`/`isSurvivorDead`/`stopSession` for persistent records/`reapOrphans`, `stopAllAndShutdown`).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server`
Expected: PASS (all, including the existing SessionManager suites).

- [ ] **Step 5: Commit**

```bash
git add server/src
git commit -m "$(cat <<'EOF'
feat(server): route each session to a persistent or direct backend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Restore direct sessions as exited placeholders

**Files:**
- Modify: `server/src/services/SessionManager.ts` (`createSession`, `restoreSessions`)
- Test: `server/src/services/SessionManager.runMode.test.ts`

**Interfaces:**
- Consumes: `createSession(..., runMode, restoreExited)` (Task 3), `InertPty` (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `SessionManager.runMode.test.ts`:

```ts
async function restoreWith(records: any[]) {
  const ctx = withBackends();
  (ctx.sm as any).store = { load: async () => records, save: async () => {} };
  await ctx.sm.restoreSessions();
  return ctx;
}

const rec = (over: any) => ({
  id: 'r1', name: 'Rebrandly', folderPath: os.tmpdir(), createdAt: '2026-09-01T00:00:00.000Z',
  agentType: 'claude', flags: ['--x'], terminalEngine: 'native', ...over,
});

test('a restored direct session comes back exited, with its metadata, and is not spawned', async () => {
  const { sm, direct, persistent } = await restoreWith([rec({ runMode: 'direct' })]);
  const s = sm.getAllSessions().find((x) => x.id === 'r1')!;
  assert.equal(s.status, 'exited');
  assert.equal(s.runMode, 'direct');
  assert.equal(s.name, 'Rebrandly');
  assert.equal(s.terminalEngine, 'native');
  assert.deepEqual(s.flags, ['--x']);
  assert.deepEqual(direct.log, []);
  assert.deepEqual(persistent.log, []);
});

test('Restart of a restored placeholder spawns through the direct backend', async () => {
  const { sm, direct, persistent } = await restoreWith([rec({ runMode: 'direct' })]);
  await sm.restartSession('r1');
  assert.ok(direct.log.includes('spawn:r1'), direct.log.join(','));
  assert.deepEqual(persistent.log.filter((l) => l.startsWith('spawn')), []);
});

test('input and resize to a restored placeholder are harmless', async () => {
  const { sm } = await restoreWith([rec({ runMode: 'direct' })]);
  assert.doesNotThrow(() => sm.writeToSession('r1', 'hello'));
  assert.doesNotThrow(() => sm.resizeSession('r1', 90, 30));
});

test('a record without runMode restores as persistent, exactly as before', async () => {
  const { sm, persistent } = await restoreWith([rec({})]);
  const s = sm.getAllSessions().find((x) => x.id === 'r1')!;
  assert.equal(s.runMode, 'persistent');
  assert.ok(persistent.log.includes('spawn:r1'), persistent.log.join(','));
});
```

If `writeToSession`/`resizeSession` return early for `exited` sessions, the harmless-test still passes; that's the intended outcome.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- --test-name-pattern "restored|placeholder|without runMode"`
Expected: FAIL — the direct record is spawned fresh.

- [ ] **Step 3: Implement**

In `createSession`, where the pty is spawned, branch on `restoreExited`:

```ts
    // A direct session restored after a restart: its agent died with the last
    // Argus (spec D2). Register it with an inert pty and status 'exited' so the
    // tile keeps its place and Restart spawns a fresh agent; never auto-spawn.
    const ptyProcess = restoreExited
      ? new InertPty(SPAWN_COLS, SPAWN_ROWS)
      : backend.spawn({ /* existing SpawnOpts object, unchanged */ });
```

Also for `restoreExited`: skip writing the signal-injection files (treat like `attachExisting` for `inj`), set `initialStatus` to `'exited'`, call `stateDetector.setExited()` after the detector is created, and set `persistent: false`. Import `InertPty` from `./ptyBackend/InertPty.js`.

In `restoreSessions`, before the survivor lookup:

```ts
      if (p.runMode === 'direct') {
        try {
          await this.createSession(p.folderPath, p.name, p.agentType, p.flags || [], p.id, p.createdAt, p.worktreeBranch, undefined, false, p.terminalEngine, 'direct', true);
          console.log(`Restored (exited) direct session: ${p.name} (${p.folderPath}) [${p.agentType}]`);
        } catch (err) {
          console.error(`Failed to restore session "${p.name}":`, err);
        }
        continue;
      }
```

`restartSession` needs no change: it routes through `backendFor(session)` (Task 3); detaching an `InertPty` is a no-op, and it spawns a real pty.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services
git commit -m "$(cat <<'EOF'
feat(server): bring direct sessions back as exited placeholders after a restart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ⌘Q asks before stopping direct sessions

**Files:**
- Create: `electron/src/quitPolicy.ts`, `electron/src/quitPolicy.test.ts`
- Modify: `electron/src/main.ts` (`before-quit` handler ~1330–1420, the server-function wiring ~1175–1180 and the `let` declarations ~410), `server/src/index.ts` (~118–140)

**Interfaces:**
- Produces: `export type QuitSummary = { name: string; status: string; terminalEngine?: string; runMode?: 'persistent' | 'direct' }`; `export function decideQuitConfirmation(i: { explicitStopAll: boolean; exitSessionsOnQuit: boolean; confirmExitOnQuit: boolean; confirmQuitDirectSessions: boolean; sessions: QuitSummary[] }): { kind: 'none' } | { kind: 'stop-all'; sessions: QuitSummary[] } | { kind: 'direct'; sessions: QuitSummary[] }`; server exports `getConfirmQuitDirectSessions(): boolean` and `setConfirmQuitDirectSessions(v: boolean): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`electron/src/quitPolicy.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideQuitConfirmation } from './quitPolicy.js';

const base = { explicitStopAll: false, exitSessionsOnQuit: false, confirmExitOnQuit: true, confirmQuitDirectSessions: true };
const direct = (name: string, status = 'running') => ({ name, status, runMode: 'direct' as const });
const persistent = (name: string) => ({ name, status: 'running', runMode: 'persistent' as const });

test('a running direct session makes a plain quit ask, listing only direct sessions', () => {
  const r = decideQuitConfirmation({ ...base, sessions: [direct('a'), persistent('b')] });
  assert.equal(r.kind, 'direct');
  assert.deepEqual(r.kind === 'direct' && r.sessions.map((s) => s.name), ['a']);
});

test('no running direct session → no dialog', () => {
  assert.equal(decideQuitConfirmation({ ...base, sessions: [persistent('b')] }).kind, 'none');
  assert.equal(decideQuitConfirmation({ ...base, sessions: [direct('a', 'exited')] }).kind, 'none');
});

test('"Don\'t ask again" turns it off', () => {
  assert.equal(decideQuitConfirmation({ ...base, confirmQuitDirectSessions: false, sessions: [direct('a')] }).kind, 'none');
});

test('the stop-all confirmation keeps precedence and covers everything', () => {
  const r = decideQuitConfirmation({ ...base, exitSessionsOnQuit: true, sessions: [direct('a'), persistent('b')] });
  assert.equal(r.kind, 'stop-all');
});

test('Quit & Stop All (explicit) never shows the direct dialog', () => {
  assert.equal(decideQuitConfirmation({ ...base, explicitStopAll: true, sessions: [direct('a')] }).kind, 'none');
});

test('stop-all with its own confirmation turned off shows nothing — direct sessions are stopped either way', () => {
  assert.equal(decideQuitConfirmation({ ...base, exitSessionsOnQuit: true, confirmExitOnQuit: false, sessions: [direct('a')] }).kind, 'none');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:electron`
Expected: FAIL — `quitPolicy.js` not found.

- [ ] **Step 3: Implement**

`electron/src/quitPolicy.ts`:

```ts
export type QuitSummary = { name: string; status: string; terminalEngine?: string; runMode?: 'persistent' | 'direct' };

export type QuitConfirmation =
  | { kind: 'none' }
  | { kind: 'stop-all'; sessions: QuitSummary[] }
  | { kind: 'direct'; sessions: QuitSummary[] };

/**
 * Which confirmation, if any, ⌘Q shows. The existing stop-all dialog (the
 * "Exit sessions on quit" setting) keeps precedence — it already covers every
 * session. Otherwise a plain quit detaches persistent sessions but kills direct
 * ones, so it asks when a direct session is still running (spec D3).
 */
export function decideQuitConfirmation(i: {
  explicitStopAll: boolean;
  exitSessionsOnQuit: boolean;
  confirmExitOnQuit: boolean;
  confirmQuitDirectSessions: boolean;
  sessions: QuitSummary[];
}): QuitConfirmation {
  const live = i.sessions.filter((s) => s.status !== 'exited');
  if (i.explicitStopAll) return { kind: 'none' };
  if (i.exitSessionsOnQuit) {
    return i.confirmExitOnQuit && live.length > 0 ? { kind: 'stop-all', sessions: live } : { kind: 'none' };
  }
  const direct = live.filter((s) => s.runMode === 'direct');
  return i.confirmQuitDirectSessions && direct.length > 0 ? { kind: 'direct', sessions: direct } : { kind: 'none' };
}
```

`server/src/index.ts`: `getActiveSessionSummaries` maps `runMode: s.runMode ?? 'persistent'` too (update its return type); add next to the `confirmExitOnQuit` pair:

```ts
export function getConfirmQuitDirectSessions(): boolean {
  return currentConfig?.confirmQuitDirectSessions !== false;
}
export async function setConfirmQuitDirectSessions(value: boolean): Promise<void> {
  const cfg = currentConfig ?? (await configStore.load());
  const updated = { ...cfg, confirmQuitDirectSessions: value };
  applyConfig(updated);
  await configStore.save(updated);
}
```

`electron/src/main.ts`:
- `import { decideQuitConfirmation } from './quitPolicy.js';` and `import type { QuitSummary } from './quitPolicy.js';`
- `let` declarations next to `getConfirmExitOnQuit`: `let getConfirmQuitDirectSessions: (() => boolean) | null = null;` and `let setConfirmQuitDirectSessions: ((v: boolean) => Promise<void>) | null = null;`; change `getActiveSessionSummaries`'s type to `(() => QuitSummary[]) | null`.
- Wiring next to `setConfirmExitOnQuit = …`: `getConfirmQuitDirectSessions = server.getConfirmQuitDirectSessions as () => boolean;` and `setConfirmQuitDirectSessions = server.setConfirmQuitDirectSessions as (v: boolean) => Promise<void>;`
- In `before-quit`, replace the `needsConfirm` computation and its `if` with a call to `decideQuitConfirmation({ explicitStopAll, exitSessionsOnQuit: settingStopAll, confirmExitOnQuit: getConfirmExitOnQuit?.() ?? true, confirmQuitDirectSessions: getConfirmQuitDirectSessions?.() ?? true, sessions: getActiveSessionSummaries?.() ?? [] })`. For `kind: 'stop-all'`, run the existing dialog code unchanged, using `decision.sessions`. For `kind: 'direct'`, show:

```ts
      const names = decision.sessions.slice(0, 10).map((s) => `• ${s.name}`).join('\n');
      const extra = decision.sessions.length > 10 ? `\n…and ${decision.sessions.length - 10} more` : '';
      const opts = {
        type: 'warning' as const,
        title: 'Stop direct sessions?',
        message: `Quitting will stop ${decision.sessions.length} direct session${decision.sessions.length === 1 ? '' : 's'}.`,
        detail: `Direct sessions run like ⌘T and stop when Argus quits:\n\n${names}${extra}\n\nPersistent sessions keep running in the background.`,
        buttons: ['Cancel', 'Quit'],
        defaultId: 1,
        cancelId: 0,
        checkboxLabel: "Don't ask again",
        checkboxChecked: false,
      };
```

  with the same show/then/catch shape as the existing dialog, calling `setConfirmQuitDirectSessions?.(false)` when the checkbox is ticked. `kind: 'none'` → `proceed()`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/src/quitPolicy.ts electron/src/quitPolicy.test.ts electron/src/main.ts server/src/index.ts
git commit -m "$(cat <<'EOF'
feat(electron): ask before ⌘Q stops running direct sessions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: UI — choose the run mode, see it, set the defaults

**Files:**
- Create: `client/src/app/ui/RunModeChoice.tsx`, `client/src/app/ui/RunModeChoice.test.tsx`
- Modify: `client/src/app/overlays/CreateSheet.tsx` (~79, ~318, ~739), `client/src/app/overlays/CloneSheet.tsx` (~27, ~41–44, ~103, ~287), `client/src/app/types.ts:7`, `client/src/app/ArgusApp.tsx` (`handleCreate`, `handleClone`, the three `kind: 'clone'` overlay openings ~751/868/913), `client/src/hooks/useSessions.ts:90-91`, `client/src/app/overlays/settings/panes/RuntimePane.tsx`, `client/src/app/overlays/settings/panes/ConfirmationsPane.tsx`, `client/src/app/overlays/settings/registry.ts` (`runtime`/`confirmations` pane `keys`, `RESETTABLE_KEYS`), `client/src/app/views/Mosaic.tsx` (~840, after the worktree branch chip), `client/src/app/views/Focus.tsx` (header, after the name)

**Interfaces:**
- Consumes: `RunMode`, `SessionInfo.runMode`, `CreateSessionRequest.runMode`, `AppConfig.defaultRunMode`, `AppConfig.confirmQuitDirectSessions` (Task 1).
- Produces: `export function RunModeChoice({ value, onChange }: { value: RunMode; onChange: (v: RunMode) => void })`.

- [ ] **Step 1: Write the failing tests**

`client/src/app/ui/RunModeChoice.test.tsx` (follow the render pattern of other `client/src/app/ui/*.test.tsx` files):

```tsx
/* eslint-disable @typescript-eslint/no-explicit-any -- React act environment */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RunModeChoice } from './RunModeChoice.js';

beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });

describe('RunModeChoice', () => {
  it('shows both modes with the selected one pressed, and reports a change', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    const onChange = vi.fn();
    act(() => root.render(<RunModeChoice value="persistent" onChange={onChange} />));
    const buttons = [...c.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Persistent'), expect.stringContaining('Direct')]));
    act(() => buttons.find((b) => b.textContent?.includes('Direct'))!.click());
    expect(onChange).toHaveBeenCalledWith('direct');
    act(() => root.unmount());
  });
});
```

Add to the CloneSheet tests (create `client/src/app/overlays/CloneSheet.test.tsx` if none exists, following an existing overlay test's setup) a test that opening the Clone sheet for a source with `runMode: 'direct'` preselects Direct and submits `runMode: 'direct'`. Add to the settings registry test (`client/src/app/overlays/settings/registry.test.ts`, which already enforces key coverage) nothing new — it must pass once the keys are registered.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client`
Expected: FAIL — `RunModeChoice` missing; registry test reports `defaultRunMode`/`confirmQuitDirectSessions` unregistered.

- [ ] **Step 3: Implement**

`client/src/app/ui/RunModeChoice.tsx`:

```tsx
import type { RunMode } from '@argus/shared';
import { Segmented } from '../../components/primitives/index.js';

const OPTIONS: readonly { value: RunMode; label: string; title: string }[] = [
  { value: 'persistent', label: 'Persistent', title: 'Survives Argus restarts (argusd/tmux)' },
  { value: 'direct', label: 'Direct', title: 'Like ⌘T — stops when Argus quits' },
];

/** Where the agent process lives (spec D1). Fixed once the session exists. */
export function RunModeChoice({ value, onChange }: { value: RunMode; onChange: (v: RunMode) => void }) {
  return <Segmented label="Run mode" value={value} options={OPTIONS} onChange={onChange} />;
}
```

(If `Segmented` does not accept `title`, drop it and put the explanation in the surrounding `Field` hint.)

`CreateSheet.tsx`: `const [runMode, setRunMode] = useState<RunMode>(config?.defaultRunMode ?? 'persistent');`; add a `<Field label="Run mode">` with `<RunModeChoice value={runMode} onChange={setRunMode} />` directly above the "Terminal engine" field; pass `runMode` as a new last argument to `onCreate` and add it to the `onCreate` prop type.

`CloneSheet.tsx`: the same, initialised from the source's run mode — add `runMode?: RunMode` to the clone overlay descriptor in `client/src/app/types.ts` (`{ kind: 'clone'; folderPath: string; agentType?: string; terminalEngine?: TerminalEngine; runMode?: RunMode }`) and read it the way the sheet reads `terminalEngine` (source first, then `config.defaultRunMode`, then `'persistent'`); pass it to `onClone`.

`ArgusApp.tsx`: `handleCreate`/`handleClone` accept a trailing `runMode?: RunMode` and pass it to `createSession`; the three `app.openOverlay({ kind: 'clone', … })` calls add `runMode: s.runMode` (or `activeSession.runMode`).

`useSessions.ts`: `createSession(..., terminalEngine?, runMode?: RunMode)` → `api.createSession({ ..., terminalEngine, runMode })`.

`RuntimePane.tsx`: a new section below "Terminal engine":

```tsx
      <Section title="Run mode">
        <SettingRow label="Default for new sessions" hint="Direct runs the agent like ⌘T and stops it when Argus quits. Persistent survives restarts.">
          <RunModeChoice value={config.defaultRunMode ?? 'persistent'} onChange={(v) => onSave({ defaultRunMode: v })} />
        </SettingRow>
      </Section>
```

`ConfirmationsPane.tsx`, in "On Quit" after the "Exit all sessions on Quit" row:

```tsx
        <SettingRow
          label="Confirm quitting with direct sessions"
          hint="Direct sessions stop when Argus quits. Ask before ⌘Q stops ones that are still running."
        >
          <Toggle
            checked={config.confirmQuitDirectSessions !== false}
            onChange={(v) => onSave({ confirmQuitDirectSessions: v })}
          />
        </SettingRow>
```

`registry.ts`: add `'defaultRunMode'` to the `runtime` pane's `keys` (and keywords `'run mode', 'direct', 'persistent'`), `'confirmQuitDirectSessions'` to the `confirmations` pane's `keys` (keyword `'direct'`), and both to `RESETTABLE_KEYS`.

Marker — `Mosaic.tsx`, after the worktree-branch chip block:

```tsx
        {session.runMode === 'direct' && (
          <Tooltip content="Direct session — stops when Argus quits">
            <span className="argus-tile-branch">Direct</span>
          </Tooltip>
        )}
```

and the same element in `Focus.tsx`'s header after the name span (reuse the `argus-tile-branch` class so both engines' headers look alike).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 5: Live check (controller runs this, with a throwaway session — not the user's sessions)**

`npm run dev`, then: create a session in a scratch folder with Run mode = Direct → the tile shows "Direct"; its terminal scrolls/selects like the ⌘T shell; ⌘Q shows "Stop direct sessions?" listing it; quit, relaunch → the tile is `exited` with its name kept; Restart starts a fresh agent. Delete the throwaway session afterwards.

- [ ] **Step 6: Commit**

```bash
git add client/src
git commit -m "$(cat <<'EOF'
feat(client): choose a session's run mode, and mark direct sessions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] `export PATH=~/.nvm/versions/node/v24.16.0/bin:$PATH && npm run verify`
- [ ] Task 6 Step 5 live check done and recorded.
