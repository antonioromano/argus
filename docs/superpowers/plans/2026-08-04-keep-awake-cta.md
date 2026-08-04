# Keep Awake CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toolbar CTA to the Argus Electron title bar that keeps the Mac awake for a chosen window (5m/15m/30m/1h/2h/4h/indefinite), shown as a live countdown pill.

**Architecture:** The server owns the window. `SleepPreventionService` is refactored from a single latch into a reason-keyed holder set (`sessions` / `ngrok` / `manual`) with one shared instance owned by `index.ts`, so the manual window and the existing automatic blockers can no longer clobber each other. A new `KeepAwakeService` owns `expiresAt` plus one timer and translates it into `acquire('manual')` / `release('manual')`, broadcasting `keepawake:status` on every transition. The client reads that status over Socket.io, and a `KeepAwakeButton` renders either a 28×28 icon (idle) or an amber countdown pill (armed) with a `ContextMenu` of durations.

**Tech Stack:** TypeScript (strict, ES2022, ESM), Express + Socket.io (server), React 19 + lucide-react (client), `node:test` (server tests), Vitest + jsdom (client tests).

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-08-04-keep-awake-cta-design.md`.
- Server imports use explicit `.js` extensions (ESM resolution). Client imports likewise use `.js`.
- Durations allowlist, exact values: `5*60_000, 15*60_000, 30*60_000, 60*60_000, 120*60_000, 240*60_000`, plus `null` = indefinite. Anything else is a `400`.
- Blocking scope is system **and** display — the existing `SleepPreventionService` mechanism. Do not add a second blocker mode.
- No persistence. No `ConfigStore` field, no boot reconcile.
- **Never use `mock.timers`** in server tests — it hangs in this repo. Expiry is tested through an injected `Scheduler`.
- Tests must not spawn `caffeinate` / `systemd-inhibit`. The platform mechanism is injected and faked in tests.
- Client HTTP goes through `authFetch` in `client/src/services/api.ts` — never bare `fetch`.
- The client has **no** `@testing-library/react`. Do not write component-render tests; extract pure logic and test that.
- Hover states change background only — never row size (repo convention).
- Toolbar buttons need `WebkitAppRegion: 'no-drag'` or they become window-drag surface.
- No new runtime dependency is introduced. (If one ever were, it must go in the **root** `package.json` too — see `docs/solutions/`.)
- Out of scope, do not build: macOS tray icon, persistence, display-sleep-only mode, command palette entry, keyboard shortcut, mobile UI.

---

## File Structure

**Server**
- `server/src/services/SleepPreventionService.ts` — *modify.* Extract the platform mechanism into `PlatformSleepBlocker`; the service becomes reason-keyed arbitration over an injectable `SleepBlocker`.
- `server/src/services/SleepPreventionService.test.ts` — *create.* Arbitration tests with a fake blocker.
- `server/src/services/KeepAwakeService.ts` — *create.* Owns the manual window: `arm` / `disarm` / `status` / `onChange` / `shutdown`, the duration allowlist, and the validator.
- `server/src/services/KeepAwakeService.test.ts` — *create.*
- `server/src/services/SessionManager.ts` — *modify.* Takes the shared blocker by injection; `start`/`stop` call sites become `acquire('sessions')` / `release('sessions')`.
- `server/src/services/NgrokService.ts` — *modify.* Same, with reason `'ngrok'`.
- `server/src/routes/keepAwake.ts` — *create.* `GET` / `POST` / `DELETE /api/keep-awake`.
- `server/src/index.ts` — *modify.* Construct the single `SleepPreventionService` + `KeepAwakeService`, inject, mount the route, wire the broadcast.

**Shared**
- `shared/src/types.ts` — *modify.* `KeepAwakeStatus` + `keepawake:status` on `ServerToClientEvents`.

**Client**
- `client/src/services/api.ts` — *modify.* Three methods.
- `client/src/app/ui/keepAwakeFormat.ts` — *create.* Pure: option list + `formatRemaining` + `remainingMs`. This is where the client's testable logic lives.
- `client/src/app/ui/keepAwakeFormat.test.ts` — *create.*
- `client/src/hooks/useKeepAwake.ts` — *create.* REST + socket + 1s render tick.
- `client/src/app/ui/KeepAwakeButton.tsx` — *create.* Idle icon / armed pill + menu.
- `client/src/app/ui/ElectronToolbar.tsx` — *modify.* Render it before the Remote Access button.
- `client/src/app/ArgusApp.tsx` — *modify.* Call the hook, thread props.

---

### Task 1: `SleepPreventionService` — reason-keyed arbitration

**Files:**
- Modify: `server/src/services/SleepPreventionService.ts` (whole file)
- Test: `server/src/services/SleepPreventionService.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type SleepHoldReason = 'sessions' | 'ngrok' | 'manual'`
  - `export interface SleepBlocker { start(): Promise<void>; stop(): Promise<void>; readonly active: boolean }`
  - `export class PlatformSleepBlocker implements SleepBlocker`
  - `export class SleepPreventionService` with `constructor(blocker?: SleepBlocker)`, `acquire(reason): Promise<void>`, `release(reason): Promise<void>`, `get heldBy(): SleepHoldReason[]`, `get active(): boolean`.
- Removed: the public `start()` / `stop()` on `SleepPreventionService`. Tasks 2 and 3 depend on that removal.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/SleepPreventionService.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SleepPreventionService } from './SleepPreventionService.js';
import type { SleepBlocker } from './SleepPreventionService.js';

class FakeBlocker implements SleepBlocker {
  starts = 0;
  stops = 0;
  private _active = false;
  failNext = false;
  async start(): Promise<void> {
    if (this.failNext) { this.failNext = false; throw new Error('blocker unavailable'); }
    this.starts++;
    this._active = true;
  }
  async stop(): Promise<void> { this.stops++; this._active = false; }
  get active(): boolean { return this._active; }
}

test('first acquire starts the blocker, extra holders do not restart it', async () => {
  const blocker = new FakeBlocker();
  const svc = new SleepPreventionService(blocker);

  await svc.acquire('sessions');
  await svc.acquire('ngrok');

  assert.equal(blocker.starts, 1);
  assert.equal(svc.active, true);
  assert.deepEqual(svc.heldBy.sort(), ['ngrok', 'sessions']);
});

test('releasing one of two holders keeps the blocker up', async () => {
  const blocker = new FakeBlocker();
  const svc = new SleepPreventionService(blocker);

  await svc.acquire('sessions');
  await svc.acquire('manual');
  await svc.release('sessions');

  assert.equal(blocker.stops, 0);
  assert.equal(svc.active, true);
  assert.deepEqual(svc.heldBy, ['manual']);
});

test('releasing the last holder stops the blocker', async () => {
  const blocker = new FakeBlocker();
  const svc = new SleepPreventionService(blocker);

  await svc.acquire('manual');
  await svc.release('manual');

  assert.equal(blocker.stops, 1);
  assert.equal(svc.active, false);
  assert.deepEqual(svc.heldBy, []);
});

test('acquire is idempotent per reason', async () => {
  const blocker = new FakeBlocker();
  const svc = new SleepPreventionService(blocker);

  await svc.acquire('sessions');
  await svc.acquire('sessions');
  await svc.release('sessions');

  assert.equal(blocker.starts, 1);
  assert.equal(blocker.stops, 1);
  assert.equal(svc.active, false);
});

test('releasing a reason that never acquired is a no-op', async () => {
  const blocker = new FakeBlocker();
  const svc = new SleepPreventionService(blocker);

  await svc.acquire('sessions');
  await svc.release('manual');

  assert.equal(blocker.stops, 0);
  assert.equal(svc.active, true);
});

test('a failing blocker does not leave a phantom holder', async () => {
  const blocker = new FakeBlocker();
  blocker.failNext = true;
  const svc = new SleepPreventionService(blocker);

  await assert.rejects(() => svc.acquire('manual'), /blocker unavailable/);
  assert.deepEqual(svc.heldBy, []);
  assert.equal(svc.active, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server 2>&1 | grep -A 5 SleepPrevention`
Expected: FAIL — `SleepPreventionService` has no `acquire`, and `SleepBlocker` is not exported.

- [ ] **Step 3: Rewrite the implementation**

Replace the whole of `server/src/services/SleepPreventionService.ts` with:

```ts
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

/** Who is currently asking the Mac to stay awake. */
export type SleepHoldReason = 'sessions' | 'ngrok' | 'manual';

/** The OS-level mechanism. Injected so tests never spawn caffeinate. */
export interface SleepBlocker {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly active: boolean;
}

/** Real mechanism: Electron powerSaveBlocker, else caffeinate / systemd-inhibit. */
export class PlatformSleepBlocker implements SleepBlocker {
  private process: ChildProcess | null = null;
  private electronBlockerId: number | undefined;

  async start(): Promise<void> {
    if (this.active) return;

    // Electron path: use powerSaveBlocker API (dynamic import avoids CLI build breakage)
    if (process.versions.electron) {
      // @ts-ignore — electron is only available at runtime in the Electron host
      const { powerSaveBlocker } = await import('electron');
      this.electronBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      return;
    }

    const platform = process.platform;

    if (platform === 'darwin') {
      this.process = spawn('caffeinate', ['-di'], { stdio: 'ignore' });
    } else if (platform === 'linux') {
      this.process = spawn(
        'systemd-inhibit',
        ['--what=idle', '--who=Argus', '--why=Argus keep-awake', 'sleep', 'infinity'],
        { stdio: 'ignore' }
      );
    } else {
      // Windows and others: no-op
      return;
    }

    this.process.on('exit', () => {
      this.process = null;
    });
  }

  async stop(): Promise<void> {
    if (process.versions.electron && this.electronBlockerId !== undefined) {
      // @ts-ignore — electron is only available at runtime in the Electron host
      const { powerSaveBlocker } = await import('electron');
      powerSaveBlocker.stop(this.electronBlockerId);
      this.electronBlockerId = undefined;
      return;
    }

    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  get active(): boolean {
    if (process.versions.electron) return this.electronBlockerId !== undefined;
    return this.process !== null;
  }
}

/**
 * Reason-keyed arbitration over one OS blocker. Several subsystems want the Mac
 * awake for unrelated reasons (a running shell, an ngrok tunnel, a manual
 * keep-awake window); with a single latch the last caller to stop() silently
 * dropped everyone else's intent. The blocker is up iff ≥1 reason is held.
 */
export class SleepPreventionService {
  private readonly holders = new Set<SleepHoldReason>();

  constructor(private readonly blocker: SleepBlocker = new PlatformSleepBlocker()) {}

  async acquire(reason: SleepHoldReason): Promise<void> {
    if (this.holders.has(reason)) return;
    this.holders.add(reason);
    if (this.holders.size > 1) return; // already blocking
    try {
      await this.blocker.start();
    } catch (err) {
      this.holders.delete(reason);
      throw err;
    }
  }

  async release(reason: SleepHoldReason): Promise<void> {
    if (!this.holders.delete(reason)) return;
    if (this.holders.size === 0) await this.blocker.stop();
  }

  get heldBy(): SleepHoldReason[] {
    return [...this.holders];
  }

  get active(): boolean {
    return this.blocker.active;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w server 2>&1 | grep -A 5 SleepPrevention`
Expected: PASS, 6 tests. `npm run build:all` will still fail — call sites are Task 2. That is expected here.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/SleepPreventionService.ts server/src/services/SleepPreventionService.test.ts
git commit -m "refactor(sleep): reason-keyed arbitration over one OS blocker"
```

---

### Task 2: Inject the shared blocker into `SessionManager` and `NgrokService`

**Files:**
- Modify: `server/src/services/SessionManager.ts:241` (field), `:260-267` (constructor), `:353-358` (`refreshSleepPrevention`), `:1470` (`shutdown`)
- Modify: `server/src/services/NgrokService.ts:39` (field), `:46-49` (constructor), `:98`, `:134`, `:172`, `:199` (call sites)
- Modify: `server/src/index.ts:131` (`new SessionManager(...)`), `:158` (`new NgrokService()`)
- Test: `server/src/services/sleepArbitration.test.ts` (create)

**Interfaces:**
- Consumes: `SleepPreventionService`, `SleepBlocker` from Task 1.
- Produces: `new SessionManager(dataDir, configStore, sleepPrevention)` and `new NgrokService(sleepPrevention)`. Task 6 constructs the shared instance and passes it to both plus `KeepAwakeService`.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/sleepArbitration.test.ts`. This is the regression the whole refactor exists for — a manual window must outlive the last shell, and vice versa.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SleepPreventionService } from './SleepPreventionService.js';
import type { SleepBlocker } from './SleepPreventionService.js';

class FakeBlocker implements SleepBlocker {
  starts = 0;
  stops = 0;
  private _active = false;
  async start(): Promise<void> { this.starts++; this._active = true; }
  async stop(): Promise<void> { this.stops++; this._active = false; }
  get active(): boolean { return this._active; }
}

test('a manual window survives the last running shell exiting', async () => {
  const blocker = new FakeBlocker();
  const sleep = new SleepPreventionService(blocker);

  await sleep.acquire('manual');   // user armed 2 hours
  await sleep.acquire('sessions'); // a shell started
  await sleep.release('sessions'); // that shell exited

  assert.equal(sleep.active, true, 'manual window must still hold the blocker');
  assert.deepEqual(sleep.heldBy, ['manual']);
});

test('turning the manual window off does not release a blocker shells still want', async () => {
  const blocker = new FakeBlocker();
  const sleep = new SleepPreventionService(blocker);

  await sleep.acquire('sessions');
  await sleep.acquire('manual');
  await sleep.release('manual');   // user hit "Turn off"

  assert.equal(sleep.active, true, 'running shells must still hold the blocker');
  assert.deepEqual(sleep.heldBy, ['sessions']);
});

test('an ngrok tunnel and a manual window are independent holders', async () => {
  const blocker = new FakeBlocker();
  const sleep = new SleepPreventionService(blocker);

  await sleep.acquire('ngrok');
  await sleep.acquire('manual');
  await sleep.release('ngrok');
  assert.equal(sleep.active, true);
  await sleep.release('manual');
  assert.equal(sleep.active, false);
  assert.equal(blocker.starts, 1);
  assert.equal(blocker.stops, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server 2>&1 | grep -B 2 -A 8 "sleepArbitration\|manual window"`
Expected: these three pass immediately (Task 1 already implements arbitration) but `npm run build:all` FAILS with `Property 'start' does not exist on type 'SleepPreventionService'` in `SessionManager.ts` and `NgrokService.ts`. **That build failure is this task's failing test.** Record it:

Run: `npm run build:all 2>&1 | grep -E "SessionManager|NgrokService"`
Expected: errors at `SessionManager.ts:357`, `:1470` and `NgrokService.ts:98`, `:134`, `:172`, `:199`.

- [ ] **Step 3: Change `SessionManager`**

Delete the self-constructed field at `server/src/services/SessionManager.ts:241`:

```ts
  private sleepPrevention = new SleepPreventionService();
```

Replace with a declaration only:

```ts
  private readonly sleepPrevention: SleepPreventionService;
```

Change the constructor (`:260`) to accept and store it:

```ts
  constructor(dataDir: string, configStore: ConfigStore, sleepPrevention: SleepPreventionService) {
    this.dataDir = dataDir;
    this.store = new SessionStore(path.join(dataDir, 'sessions.json'));
    this.configStore = configStore;
    this.sleepPrevention = sleepPrevention;
    this.ptyManager = new PtyManager(dataDir);
    this.backend = makePtyBackend(this.ptyManager, dataDir);
    this.wireBackend();
  }
```

Change `refreshSleepPrevention` (`:353`) — same want/decision, new verbs:

```ts
  private refreshSleepPrevention(): void {
    let running = 0;
    for (const s of this.sessions.values()) if (s.status === 'running') running++;
    const want = this.preventSleepWhileRunning && running > 0;
    (want
      ? this.sleepPrevention.acquire('sessions')
      : this.sleepPrevention.release('sessions')
    ).catch(console.error);
  }
```

Change `shutdown` (`:1470`):

```ts
    await this.sleepPrevention.release('sessions');
```

- [ ] **Step 4: Change `NgrokService`**

At `server/src/services/NgrokService.ts:46`, take the service by injection:

```ts
  constructor(sleepPrevention: SleepPreventionService) {
    this.ngrokPath = findNgrok();
    this.sleepPrevention = sleepPrevention;
  }
```

Then replace all four call sites:

- `:98` and `:172` — both are `this.sleepPrevention.start().catch(...)`:

```ts
      this.sleepPrevention.acquire('ngrok').catch((err) => {
        console.error('[ngrok] sleepPrevention.acquire failed:', err);
      });
```

- `:134` and `:199` — both are bare `this.sleepPrevention.stop();`:

```ts
    void this.sleepPrevention.release('ngrok');
```

- [ ] **Step 5: Update the two construction sites in `index.ts`**

At `server/src/index.ts`, add the shared instance above `new SessionManager` (line ~130) and pass it to both:

```ts
// One OS-level sleep blocker, arbitrated by reason across sessions / ngrok / manual.
const sleepPrevention = new SleepPreventionService();

// Session manager
const sessionManager = new SessionManager(dataDir, configStore, sleepPrevention);
```

and at `:158`:

```ts
ngrokService = new NgrokService(sleepPrevention);
```

Add the import near the other service imports:

```ts
import { SleepPreventionService } from './services/SleepPreventionService.js';
```

- [ ] **Step 6: Verify build and tests are green**

Run: `npm run build:all && npm test -w server`
Expected: build clean, all server tests pass (including the pre-existing `SessionManager.nativeSignals.test.ts`, which stubs `refreshSleepPrevention` and is unaffected).

If a pre-existing test constructs `new SessionManager(dataDir, configStore)` with two args, add `new SleepPreventionService(new FakeBlocker())`-style third argument — or simply `new SleepPreventionService()` if the test never triggers a running session. Find them with:

Run: `grep -rn "new SessionManager(" server/src | grep -v index.ts`

- [ ] **Step 7: Commit**

```bash
git add server/src/services/SessionManager.ts server/src/services/NgrokService.ts server/src/index.ts server/src/services/sleepArbitration.test.ts
git commit -m "refactor(sleep): share one blocker across sessions and ngrok"
```

---

### Task 3: `KeepAwakeStatus` shared type + socket event

**Files:**
- Modify: `shared/src/types.ts` (add interface; add one line to `ServerToClientEvents` at `:222-247`)

**Interfaces:**
- Produces:
  - `export interface KeepAwakeStatus { active: boolean; expiresAt: number | null; indefinite: boolean }`
  - `'keepawake:status': (status: KeepAwakeStatus) => void` on `ServerToClientEvents`.
- Consumed by Tasks 4, 5, 6, 7, 8, 9.

- [ ] **Step 1: Add the type**

In `shared/src/types.ts`, next to `NgrokStatus` (around `:278`):

```ts
/**
 * State of the manual "keep this Mac awake" window. Server-owned: the client
 * renders a countdown from `expiresAt` but never decides when the window ends.
 * Not persisted — an armed window dies with the app.
 */
export interface KeepAwakeStatus {
  active: boolean;
  /** Epoch ms when the window ends. null when off, and null when indefinite. */
  expiresAt: number | null;
  indefinite: boolean;
}
```

- [ ] **Step 2: Add the socket event**

Inside `ServerToClientEvents` (`:222`), after the `'ngrok:status'` line:

```ts
  'keepawake:status': (status: KeepAwakeStatus) => void;
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build:all`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(shared): KeepAwakeStatus type and keepawake:status event"
```

---

### Task 4: `KeepAwakeService`

**Files:**
- Create: `server/src/services/KeepAwakeService.ts`
- Test: `server/src/services/KeepAwakeService.test.ts`

**Interfaces:**
- Consumes: `SleepPreventionService` (Task 1), `KeepAwakeStatus` (Task 3).
- Produces:
  - `export const KEEP_AWAKE_DURATIONS_MS: readonly number[]`
  - `export function isKeepAwakeDuration(v: unknown): v is number | null`
  - `export type Scheduler = (fn: () => void, ms: number) => () => void`
  - `export class KeepAwakeService` with `constructor(sleep: SleepPreventionService, now?: () => number, schedule?: Scheduler)`, `arm(durationMs: number | null): Promise<KeepAwakeStatus>`, `disarm(): Promise<KeepAwakeStatus>`, `get status(): KeepAwakeStatus`, `onChange(cb: (s: KeepAwakeStatus) => void): void`, `shutdown(): Promise<void>`.
- Consumed by Tasks 5 and 6.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/KeepAwakeService.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { KeepAwakeStatus } from '@argus/shared';
import { KeepAwakeService, isKeepAwakeDuration } from './KeepAwakeService.js';
import { SleepPreventionService } from './SleepPreventionService.js';
import type { SleepBlocker } from './SleepPreventionService.js';

class FakeBlocker implements SleepBlocker {
  starts = 0;
  stops = 0;
  private _active = false;
  async start(): Promise<void> { this.starts++; this._active = true; }
  async stop(): Promise<void> { this.stops++; this._active = false; }
  get active(): boolean { return this._active; }
}

/** Captures scheduled callbacks so expiry is triggered explicitly — no fake timers. */
function fakeScheduler() {
  const pending: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const schedule = (fn: () => void, ms: number) => {
    const entry = { fn, ms, cancelled: false };
    pending.push(entry);
    return () => { entry.cancelled = true; };
  };
  const fireLast = async () => {
    const entry = pending[pending.length - 1];
    assert.ok(entry, 'nothing scheduled');
    assert.equal(entry.cancelled, false, 'last scheduled timer was cancelled');
    entry.fn();
    await new Promise((r) => setImmediate(r)); // let the async disarm settle
  };
  return { pending, schedule, fireLast };
}

function build(startAt = 1_000_000) {
  const blocker = new FakeBlocker();
  const sleep = new SleepPreventionService(blocker);
  const sched = fakeScheduler();
  let now = startAt;
  const svc = new KeepAwakeService(sleep, () => now, sched.schedule);
  return { blocker, sleep, sched, svc, setNow: (t: number) => { now = t; }, startAt };
}

test('starts off', () => {
  const { svc } = build();
  assert.deepEqual(svc.status, { active: false, expiresAt: null, indefinite: false });
});

test('arm acquires the blocker and reports the expiry', async () => {
  const { svc, blocker, sleep, startAt } = build();

  const status = await svc.arm(30 * 60_000);

  assert.deepEqual(status, { active: true, expiresAt: startAt + 30 * 60_000, indefinite: false });
  assert.equal(blocker.starts, 1);
  assert.deepEqual(sleep.heldBy, ['manual']);
});

test('expiry releases the blocker and notifies', async () => {
  const { svc, blocker, sleep, sched } = build();
  const seen: KeepAwakeStatus[] = [];
  svc.onChange((s) => seen.push(s));

  await svc.arm(5 * 60_000);
  assert.equal(sched.pending[0].ms, 5 * 60_000);

  await sched.fireLast();

  assert.deepEqual(svc.status, { active: false, expiresAt: null, indefinite: false });
  assert.equal(blocker.stops, 1);
  assert.deepEqual(sleep.heldBy, []);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].active, true);
  assert.equal(seen[1].active, false);
});

test('disarm before expiry cancels the timer', async () => {
  const { svc, sched, blocker } = build();

  await svc.arm(60 * 60_000);
  await svc.disarm();

  assert.equal(sched.pending[0].cancelled, true);
  assert.equal(blocker.stops, 1);
  assert.equal(svc.status.active, false);
});

test('re-arm replaces the window instead of stacking', async () => {
  const { svc, sched, blocker, startAt } = build();

  await svc.arm(5 * 60_000);
  const status = await svc.arm(2 * 60 * 60_000);

  assert.equal(sched.pending.length, 2);
  assert.equal(sched.pending[0].cancelled, true, 'the 5m timer must be cancelled');
  assert.equal(sched.pending[1].cancelled, false);
  assert.equal(status.expiresAt, startAt + 2 * 60 * 60_000);
  assert.equal(blocker.starts, 1, 'still one OS blocker');
  assert.equal(blocker.stops, 0);
});

test('indefinite never schedules an expiry', async () => {
  const { svc, sched } = build();

  const status = await svc.arm(null);

  assert.deepEqual(status, { active: true, expiresAt: null, indefinite: true });
  assert.equal(sched.pending.length, 0);
});

test('a failing blocker leaves the service off', async () => {
  const blocker = new FakeBlocker();
  blocker.start = async () => { throw new Error('powerSaveBlocker unavailable'); };
  const sleep = new SleepPreventionService(blocker);
  const svc = new KeepAwakeService(sleep, () => 0, (fn, ms) => { void fn; void ms; return () => {}; });

  await assert.rejects(() => svc.arm(5 * 60_000), /unavailable/);
  assert.deepEqual(svc.status, { active: false, expiresAt: null, indefinite: false });
  assert.deepEqual(sleep.heldBy, []);
});

test('shutdown cancels the timer and releases', async () => {
  const { svc, sched, blocker } = build();

  await svc.arm(4 * 60 * 60_000);
  await svc.shutdown();

  assert.equal(sched.pending[0].cancelled, true);
  assert.equal(blocker.stops, 1);
});

test('isKeepAwakeDuration accepts the allowlist and null only', () => {
  for (const ms of [5, 15, 30, 60, 120, 240].map((m) => m * 60_000)) {
    assert.equal(isKeepAwakeDuration(ms), true, `${ms} should be allowed`);
  }
  assert.equal(isKeepAwakeDuration(null), true);
  assert.equal(isKeepAwakeDuration(0), false);
  assert.equal(isKeepAwakeDuration(-60_000), false);
  assert.equal(isKeepAwakeDuration(7 * 60_000), false);
  assert.equal(isKeepAwakeDuration(8 * 60 * 60_000), false);
  assert.equal(isKeepAwakeDuration('300000'), false);
  assert.equal(isKeepAwakeDuration(undefined), false);
  assert.equal(isKeepAwakeDuration(Number.POSITIVE_INFINITY), false);
  assert.equal(isKeepAwakeDuration(Number.NaN), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server 2>&1 | grep -i keepawake`
Expected: FAIL — cannot find module `./KeepAwakeService.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/services/KeepAwakeService.ts`:

```ts
import type { KeepAwakeStatus } from '@argus/shared';
import type { SleepPreventionService } from './SleepPreventionService.js';

/** The only windows the UI offers, and the only ones the API accepts. */
export const KEEP_AWAKE_DURATIONS_MS: readonly number[] = [
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  120 * 60_000,
  240 * 60_000,
];

/** `null` means "indefinitely". Anything outside the allowlist is rejected. */
export function isKeepAwakeDuration(v: unknown): v is number | null {
  if (v === null) return true;
  return typeof v === 'number' && KEEP_AWAKE_DURATIONS_MS.includes(v);
}

/** Returns a cancel function. Injected so expiry is testable without fake timers. */
export type Scheduler = (fn: () => void, ms: number) => () => void;

const realScheduler: Scheduler = (fn, ms) => {
  const t = setTimeout(fn, ms);
  t.unref(); // a pending window must never keep the process alive
  return () => clearTimeout(t);
};

/**
 * Owns the manual keep-awake window: one expiry, one timer, and the 'manual'
 * hold on the shared sleep blocker. Deliberately not persisted — an armed
 * window dies with the app.
 */
export class KeepAwakeService {
  private expiresAt: number | null = null;
  private indefinite = false;
  private cancelTimer: (() => void) | null = null;
  private readonly listeners: ((s: KeepAwakeStatus) => void)[] = [];

  constructor(
    private readonly sleep: SleepPreventionService,
    private readonly now: () => number = Date.now,
    private readonly schedule: Scheduler = realScheduler
  ) {}

  get status(): KeepAwakeStatus {
    return {
      active: this.indefinite || this.expiresAt !== null,
      expiresAt: this.expiresAt,
      indefinite: this.indefinite,
    };
  }

  onChange(cb: (s: KeepAwakeStatus) => void): void {
    this.listeners.push(cb);
  }

  /** `durationMs === null` arms indefinitely. Re-arming replaces the window. */
  async arm(durationMs: number | null): Promise<KeepAwakeStatus> {
    this.clearTimer();

    if (durationMs === null) {
      this.indefinite = true;
      this.expiresAt = null;
    } else {
      this.indefinite = false;
      this.expiresAt = this.now() + durationMs;
      this.cancelTimer = this.schedule(() => { void this.disarm(); }, durationMs);
    }

    try {
      await this.sleep.acquire('manual');
    } catch (err) {
      this.reset();
      throw err;
    }

    this.emit();
    return this.status;
  }

  async disarm(): Promise<KeepAwakeStatus> {
    this.reset();
    await this.sleep.release('manual');
    this.emit();
    return this.status;
  }

  async shutdown(): Promise<void> {
    this.reset();
    await this.sleep.release('manual');
  }

  private reset(): void {
    this.clearTimer();
    this.expiresAt = null;
    this.indefinite = false;
  }

  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private emit(): void {
    const s = this.status;
    for (const cb of this.listeners) cb(s);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w server 2>&1 | grep -i -A 3 keepawake`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/KeepAwakeService.ts server/src/services/KeepAwakeService.test.ts
git commit -m "feat(server): KeepAwakeService owns the manual keep-awake window"
```

---

### Task 5: `/api/keep-awake` routes

**Files:**
- Create: `server/src/routes/keepAwake.ts`
- Test: `server/src/routes/keepAwake.test.ts`

**Interfaces:**
- Consumes: `KeepAwakeService`, `isKeepAwakeDuration` (Task 4).
- Produces: `export function createKeepAwakeRoutes(keepAwake: KeepAwakeService): Router` and `export const KEEP_AWAKE_BAD_DURATION` (the 400 message, asserted in the test).
- Consumed by Task 6.

There is no `supertest` in this repo, so the test drives the router's handlers directly through a minimal fake `req`/`res` rather than over HTTP.

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/keepAwake.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { createKeepAwakeRoutes, KEEP_AWAKE_BAD_DURATION } from './keepAwake.js';
import { KeepAwakeService } from '../services/KeepAwakeService.js';
import { SleepPreventionService } from '../services/SleepPreventionService.js';
import type { SleepBlocker } from '../services/SleepPreventionService.js';

class FakeBlocker implements SleepBlocker {
  private _active = false;
  async start(): Promise<void> { this._active = true; }
  async stop(): Promise<void> { this._active = false; }
  get active(): boolean { return this._active; }
}

function fakeRes() {
  const out: { code: number; body: unknown } = { code: 200, body: undefined };
  const res = {
    status(c: number) { out.code = c; return this; },
    json(b: unknown) { out.body = b; return this; },
  } as unknown as Response;
  return { res, out };
}

/** Pull a handler off the router's stack by method + path. */
function handlerFor(router: ReturnType<typeof createKeepAwakeRoutes>, method: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (router as any).stack.find((l: any) => l.route?.methods?.[method]);
  assert.ok(layer, `no ${method} handler registered`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: (e?: unknown) => void) => unknown;
}

function build() {
  const svc = new KeepAwakeService(
    new SleepPreventionService(new FakeBlocker()),
    () => 1_000_000,
    (fn, ms) => { void fn; void ms; return () => {}; }
  );
  return { svc, router: createKeepAwakeRoutes(svc) };
}

test('GET returns the current status', async () => {
  const { router } = build();
  const { res, out } = fakeRes();

  await handlerFor(router, 'get')({} as Request, res, () => {});

  assert.deepEqual(out.body, { active: false, expiresAt: null, indefinite: false });
});

test('POST with an allowlisted duration arms and echoes the status', async () => {
  const { router, svc } = build();
  const { res, out } = fakeRes();

  await handlerFor(router, 'post')({ body: { durationMs: 30 * 60_000 } } as Request, res, () => {});

  assert.equal(out.code, 200);
  assert.deepEqual(out.body, { active: true, expiresAt: 1_000_000 + 30 * 60_000, indefinite: false });
  assert.equal(svc.status.active, true);
});

test('POST with null arms indefinitely', async () => {
  const { router } = build();
  const { res, out } = fakeRes();

  await handlerFor(router, 'post')({ body: { durationMs: null } } as Request, res, () => {});

  assert.deepEqual(out.body, { active: true, expiresAt: null, indefinite: true });
});

test('POST rejects a duration outside the allowlist', async () => {
  const { router, svc } = build();

  for (const bad of [7 * 60_000, -1, 0, '30m', undefined, Number.NaN]) {
    const { res, out } = fakeRes();
    await handlerFor(router, 'post')({ body: { durationMs: bad } } as Request, res, () => {});
    assert.equal(out.code, 400, `${String(bad)} should be rejected`);
    assert.deepEqual(out.body, { error: KEEP_AWAKE_BAD_DURATION });
  }
  assert.equal(svc.status.active, false, 'no rejected request may arm the blocker');
});

test('POST with no body is a 400, not a crash', async () => {
  const { router } = build();
  const { res, out } = fakeRes();

  await handlerFor(router, 'post')({} as Request, res, () => {});

  assert.equal(out.code, 400);
});

test('DELETE disarms', async () => {
  const { router, svc } = build();
  await svc.arm(60 * 60_000);
  const { res, out } = fakeRes();

  await handlerFor(router, 'delete')({} as Request, res, () => {});

  assert.deepEqual(out.body, { active: false, expiresAt: null, indefinite: false });
  assert.equal(svc.status.active, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w server 2>&1 | grep -i "keepAwake.test\|Cannot find module"`
Expected: FAIL — cannot find module `./keepAwake.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/routes/keepAwake.ts`:

```ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isKeepAwakeDuration } from '../services/KeepAwakeService.js';
import type { KeepAwakeService } from '../services/KeepAwakeService.js';

export const KEEP_AWAKE_BAD_DURATION =
  'durationMs must be null (indefinite) or one of: 5, 15, 30, 60, 120, 240 minutes.';

/**
 * Manual keep-awake window. Mounted behind the bearer-auth middleware, so a
 * remote/mobile client cannot arm the Mac's sleep blocker unauthenticated.
 * No filesystem paths are involved, so pathScope does not apply here.
 */
export function createKeepAwakeRoutes(keepAwake: KeepAwakeService): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(keepAwake.status);
  });

  router.post('/', asyncHandler(async (req, res) => {
    const durationMs = (req.body ?? {}).durationMs;
    if (!isKeepAwakeDuration(durationMs)) {
      res.status(400).json({ error: KEEP_AWAKE_BAD_DURATION });
      return;
    }
    res.json(await keepAwake.arm(durationMs));
  }));

  router.delete('/', asyncHandler(async (_req, res) => {
    res.json(await keepAwake.disarm());
  }));

  return router;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w server 2>&1 | grep -i -A 3 "keepAwake"`
Expected: PASS, 6 route tests (plus Task 4's 9).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/keepAwake.ts server/src/routes/keepAwake.test.ts
git commit -m "feat(server): /api/keep-awake routes with duration allowlist"
```

---

### Task 6: Wire it up in `index.ts`

**Files:**
- Modify: `server/src/index.ts` — imports, service construction (next to the `sleepPrevention` added in Task 2), route mount alongside `:201-206`

**Interfaces:**
- Consumes: `KeepAwakeService` (Task 4), `createKeepAwakeRoutes` (Task 5), the shared `sleepPrevention` (Task 2), `io` (`server/src/index.ts:91`).
- Produces: a live `keepawake:status` broadcast and a mounted `/api/keep-awake`.

- [ ] **Step 1: Add the imports**

In `server/src/index.ts`, beside the existing route and service imports:

```ts
import { createKeepAwakeRoutes } from './routes/keepAwake.js';
import { KeepAwakeService } from './services/KeepAwakeService.js';
```

- [ ] **Step 2: Construct the service and broadcast its transitions**

Directly after the `const sleepPrevention = new SleepPreventionService();` line added in Task 2:

```ts
// Manual keep-awake window (toolbar CTA). Server-owned expiry; every transition
// is broadcast so a second window never shows a stale countdown.
const keepAwakeService = new KeepAwakeService(sleepPrevention);
keepAwakeService.onChange((status) => {
  io.emit('keepawake:status', status);
});
```

`io` is created at `:91`, above this point, so the reference is valid.

- [ ] **Step 3: Mount the route**

Next to the other mounts (after `app.use('/api/ngrok', ...)` at `:201`), i.e. **after** `createAuthMiddleware` so the endpoint is token-gated:

```ts
app.use('/api/keep-awake', createKeepAwakeRoutes(keepAwakeService));
```

- [ ] **Step 4: Verify by hand**

Run: `npm run build:all && npm test`
Expected: build clean, all tests pass.

Then check the endpoint is actually gated and functional. Start the dev app in one shell:

Run: `npm run dev`

In another shell (dev Electron mode serves on port 5403):

```bash
curl -s localhost:5403/api/keep-awake
curl -s -X POST localhost:5403/api/keep-awake -H 'Content-Type: application/json' -d '{"durationMs":300000}'
pmset -g assertions | grep -i -E "PreventUserIdleDisplaySleep|caffeinate"
curl -s -X DELETE localhost:5403/api/keep-awake
```

Expected: the `GET` returns `{"active":false,...}`; the `POST` returns `active:true` with an `expiresAt` ~5 minutes out; `pmset -g assertions` shows a display-sleep assertion held by Argus/Electron; the `DELETE` returns `active:false` and the assertion disappears. (If a password is set or ngrok is running, auth is enforced — add `-H "Authorization: Bearer <token>"`.)

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): mount keep-awake routes and broadcast status"
```

---

### Task 7: Client API methods

**Files:**
- Modify: `client/src/services/api.ts` — the type import on `:1`, and three methods next to `recheckNgrok` (`:396`)

**Interfaces:**
- Consumes: `KeepAwakeStatus` (Task 3).
- Produces: `api.getKeepAwake()`, `api.armKeepAwake(durationMs: number | null)`, `api.disarmKeepAwake()`, each returning `Promise<KeepAwakeStatus>`.
- Consumed by Task 9.

- [ ] **Step 1: Extend the shared-type import**

Add `KeepAwakeStatus` to the existing `import type { ... } from '@argus/shared';` list on `client/src/services/api.ts:1`.

- [ ] **Step 2: Add the three methods**

After `recheckNgrok` (`:396-399`), inside the same `api` object:

```ts
  getKeepAwake: async (): Promise<KeepAwakeStatus> => {
    const res = await authFetch(`${API_BASE}/keep-awake`);
    return (await requireOk(res)).json();
  },

  /** `durationMs: null` arms indefinitely. */
  armKeepAwake: async (durationMs: number | null): Promise<KeepAwakeStatus> => {
    const res = await authFetch(`${API_BASE}/keep-awake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationMs }),
    });
    return (await requireOk(res)).json();
  },

  disarmKeepAwake: async (): Promise<KeepAwakeStatus> => {
    const res = await authFetch(`${API_BASE}/keep-awake`, { method: 'DELETE' });
    return (await requireOk(res)).json();
  },
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build:all && npm run lint -w client`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add client/src/services/api.ts
git commit -m "feat(client): keep-awake API methods"
```

---

### Task 8: Countdown formatting + option list (pure logic)

**Files:**
- Create: `client/src/app/ui/keepAwakeFormat.ts`
- Test: `client/src/app/ui/keepAwakeFormat.test.ts`

**Interfaces:**
- Produces:
  - `export interface KeepAwakeOption { label: string; hint: string; durationMs: number | null }`
  - `export const KEEP_AWAKE_OPTIONS: readonly KeepAwakeOption[]` (7 entries, indefinite last)
  - `export function remainingMs(expiresAt: number | null, now: number): number`
  - `export function formatRemaining(ms: number): string`
- Consumed by Task 10.

Note: the client has no `@testing-library/react`, so this task is where the client's behavior gets tested. Keep the component in Task 9 free of logic that is not covered here.

- [ ] **Step 1: Write the failing test**

Create `client/src/app/ui/keepAwakeFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { KEEP_AWAKE_OPTIONS, formatRemaining, remainingMs } from './keepAwakeFormat.js';

describe('KEEP_AWAKE_OPTIONS', () => {
  it('offers exactly the seven designed windows, indefinite last', () => {
    expect(KEEP_AWAKE_OPTIONS.map((o) => o.durationMs)).toEqual([
      5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 120 * 60_000, 240 * 60_000, null,
    ]);
    expect(KEEP_AWAKE_OPTIONS.map((o) => o.hint)).toEqual(['5m', '15m', '30m', '1h', '2h', '4h', '∞']);
  });
});

describe('formatRemaining', () => {
  it('renders MM:SS below an hour', () => {
    expect(formatRemaining(5 * 60_000)).toBe('5:00');
    expect(formatRemaining(59_000)).toBe('0:59');
    expect(formatRemaining(9_000)).toBe('0:09');
  });

  it('renders H:MM:SS at or above an hour', () => {
    expect(formatRemaining(60 * 60_000)).toBe('1:00:00');
    expect(formatRemaining(2 * 60 * 60_000 - 1_000)).toBe('1:59:59');
    expect(formatRemaining(4 * 60 * 60_000)).toBe('4:00:00');
  });

  it('rounds up so a fresh window never shows one second short', () => {
    expect(formatRemaining(29 * 60_000 + 999)).toBe('30:00');
  });

  it('clamps at zero rather than going negative', () => {
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(-5_000)).toBe('0:00');
  });
});

describe('remainingMs', () => {
  it('is the gap between expiry and now', () => {
    expect(remainingMs(1_000_000 + 30_000, 1_000_000)).toBe(30_000);
  });

  it('is zero once expired', () => {
    expect(remainingMs(1_000_000, 1_500_000)).toBe(0);
  });

  it('is zero when there is no expiry (off, or indefinite)', () => {
    expect(remainingMs(null, 1_000_000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w client 2>&1 | grep -i keepAwakeFormat`
Expected: FAIL — cannot resolve `./keepAwakeFormat.js`.

- [ ] **Step 3: Write the implementation**

Create `client/src/app/ui/keepAwakeFormat.ts`:

```ts
export interface KeepAwakeOption {
  label: string;
  /** Right-aligned muted shorthand in the menu. */
  hint: string;
  /** null = indefinitely. */
  durationMs: number | null;
}

export const KEEP_AWAKE_OPTIONS: readonly KeepAwakeOption[] = [
  { label: '5 minutes', hint: '5m', durationMs: 5 * 60_000 },
  { label: '15 minutes', hint: '15m', durationMs: 15 * 60_000 },
  { label: '30 minutes', hint: '30m', durationMs: 30 * 60_000 },
  { label: '1 hour', hint: '1h', durationMs: 60 * 60_000 },
  { label: '2 hours', hint: '2h', durationMs: 120 * 60_000 },
  { label: '4 hours', hint: '4h', durationMs: 240 * 60_000 },
  { label: 'Indefinitely', hint: '∞', durationMs: null },
];

/** Milliseconds left, clamped at 0. `null` (off or indefinite) yields 0. */
export function remainingMs(expiresAt: number | null, now: number): number {
  if (expiresAt === null) return 0;
  return Math.max(0, expiresAt - now);
}

/**
 * `H:MM:SS` at or above an hour, `M:SS` below. Rounds up so an armed 30-minute
 * window reads "30:00" rather than "29:59" on the first paint.
 */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w client 2>&1 | grep -i -A 3 keepAwakeFormat`
Expected: PASS, 9 assertions across 3 describes.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/ui/keepAwakeFormat.ts client/src/app/ui/keepAwakeFormat.test.ts
git commit -m "feat(client): keep-awake option list and countdown formatting"
```

---

### Task 9: `useKeepAwake` hook

**Files:**
- Create: `client/src/hooks/useKeepAwake.ts`

**Interfaces:**
- Consumes: `api.getKeepAwake` / `armKeepAwake` / `disarmKeepAwake` (Task 7), `KeepAwakeStatus` and `'keepawake:status'` (Task 3).
- Produces: `useKeepAwake(socket: TypedSocket)` returning `{ status: KeepAwakeStatus | null; arm: (durationMs: number | null) => Promise<void>; disarm: () => Promise<void> }`.
- Consumed by Task 11.

- [ ] **Step 1: Write the hook**

Create `client/src/hooks/useKeepAwake.ts`, mirroring `useNgrok`'s shape (REST to mutate, socket as the source of truth):

```ts
import { useState, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, KeepAwakeStatus } from '@argus/shared';
import { api } from '../services/api.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Manual keep-awake window. The server owns expiry — this hook never decides
 * when the window ends, it only mutates via REST and renders what the server
 * broadcasts. Status is re-fetched on reconnect so a missed broadcast heals.
 */
export function useKeepAwake(socket: TypedSocket) {
  const [status, setStatus] = useState<KeepAwakeStatus | null>(null);

  useEffect(() => {
    api.getKeepAwake().then(setStatus).catch(console.error);
  }, []);

  useEffect(() => {
    const handleStatus = (next: KeepAwakeStatus) => setStatus(next);
    const resync = () => { api.getKeepAwake().then(setStatus).catch(console.error); };
    socket.on('keepawake:status', handleStatus);
    socket.on('connect', resync);
    return () => {
      socket.off('keepawake:status', handleStatus);
      socket.off('connect', resync);
    };
  }, [socket]);

  const arm = useCallback(async (durationMs: number | null) => {
    try {
      setStatus(await api.armKeepAwake(durationMs));
    } catch (err) {
      console.error('[keep-awake] arm failed:', err);
    }
  }, []);

  const disarm = useCallback(async () => {
    try {
      setStatus(await api.disarmKeepAwake());
    } catch (err) {
      console.error('[keep-awake] disarm failed:', err);
    }
  }, []);

  return { status, arm, disarm };
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run build:all && npm run lint -w client`
Expected: clean. (No unit test: exercising a hook needs a renderer, and this repo has no `@testing-library/react`. Its logic is deliberately thin — all formatting lives in Task 8, and the arm/disarm/expiry semantics are covered server-side in Task 4.)

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useKeepAwake.ts
git commit -m "feat(client): useKeepAwake hook"
```

---

### Task 10: `KeepAwakeButton` — idle icon / armed countdown pill

**Files:**
- Create: `client/src/app/ui/KeepAwakeButton.tsx`

**Interfaces:**
- Consumes: `KEEP_AWAKE_OPTIONS`, `formatRemaining`, `remainingMs` (Task 8); `KeepAwakeStatus` (Task 3); `ContextMenu` + `ContextMenuEntry` from `client/src/components/primitives/ContextMenu.tsx`; `Tooltip` from `client/src/components/primitives/index.js`.
- Produces: `export function KeepAwakeButton(props: { status: KeepAwakeStatus | null; onArm: (durationMs: number | null) => void; onDisarm: () => void })`.
- Consumed by Task 11.

Design notes this component must honor (from the spec):
- Idle chrome is byte-identical to the other tray buttons: 28×28, `1px solid transparent`, `var(--r-2)`, `var(--fg-2)`, `WebkitAppRegion: 'no-drag'`.
- Armed is an amber pill: `var(--accent-edge)` border, `var(--accent-bg)` background, `var(--accent)` text, mono tabular countdown with a fixed `minWidth` so ticking digits never jitter.
- The 1s tick must only run while a finite window is armed.

- [ ] **Step 1: Write the component**

Create `client/src/app/ui/KeepAwakeButton.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Coffee, Check, PowerOff } from 'lucide-react';
import type { KeepAwakeStatus } from '@argus/shared';
import { Tooltip } from '../../components/primitives/index.js';
import { ContextMenu } from '../../components/primitives/ContextMenu.js';
import type { ContextMenuEntry } from '../../components/primitives/ContextMenu.js';
import { KEEP_AWAKE_OPTIONS, formatRemaining, remainingMs } from './keepAwakeFormat.js';

interface KeepAwakeButtonProps {
  status: KeepAwakeStatus | null;
  onArm: (durationMs: number | null) => void;
  onDisarm: () => void;
}

const noDrag = {
  // @ts-expect-error Electron-only
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;

const idleBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: '1px solid transparent',
  borderRadius: 'var(--r-2)',
  background: 'transparent',
  color: 'var(--fg-2)',
  cursor: 'pointer',
  transition: 'background var(--dur-fast) var(--ease-std), color var(--dur-fast)',
  ...noDrag,
};

const armedPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 28,
  padding: '0 8px 0 7px',
  border: '1px solid var(--accent-edge)',
  borderRadius: 'var(--r-2)',
  background: 'var(--accent-bg)',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--t-tiny)',
  fontVariantNumeric: 'tabular-nums',
  ...noDrag,
};

export function KeepAwakeButton({ status, onArm, onDisarm }: KeepAwakeButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [, forceTick] = useState(0);

  const active = status?.active ?? false;
  const expiresAt = status?.expiresAt ?? null;
  const indefinite = status?.indefinite ?? false;

  // Re-render once a second, but only while a finite window is actually armed.
  useEffect(() => {
    if (!active || expiresAt === null) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active, expiresAt]);

  const left = remainingMs(expiresAt, Date.now());
  const countdown = indefinite ? '∞' : formatRemaining(left);

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    // ContextMenu clamps itself inside the viewport, so a raw anchor is fine.
    setMenuAt(rect ? { x: rect.left, y: rect.bottom + 6 } : { x: 0, y: 34 });
  };

  const header = active
    ? indefinite ? 'Keep awake · on' : `Keep awake · ${countdown} left`
    : 'Keep awake';

  const items: ContextMenuEntry[] = [
    { header },
    ...KEEP_AWAKE_OPTIONS.map((o) => ({
      id: `keep-awake-${o.hint}`,
      label: o.label,
      shortcut: o.hint,
      // Only the indefinite row can be checked: KeepAwakeStatus carries expiresAt,
      // not the duration originally chosen, and reverse-deriving "which row did you
      // press" from a ticking expiresAt would be wrong one second later. A finite
      // window's remaining time is already in the header. Do NOT add a durationMs
      // field to KeepAwakeStatus just to draw this checkmark.
      icon: active && o.durationMs === null && indefinite ? Check : undefined,
      onClick: () => onArm(o.durationMs),
    })),
    ...(active
      ? ([{ separator: true }, {
          id: 'keep-awake-off',
          label: 'Turn off',
          icon: PowerOff,
          danger: true,
          onClick: onDisarm,
        }] as ContextMenuEntry[])
      : []),
  ];

  return (
    <>
      <Tooltip content={active ? (indefinite ? 'Keeping Mac awake' : `Keeping Mac awake — ${countdown} left`) : 'Keep Mac awake'}>
        <button ref={btnRef} onClick={openMenu} style={active ? armedPill : idleBtn} aria-label="Keep Mac awake">
          <Coffee size={13} strokeWidth={1.6} />
          {active && <span style={{ minWidth: 44, textAlign: 'right' }}>{countdown}</span>}
        </button>
      </Tooltip>
      {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} items={items} onClose={() => setMenuAt(null)} />}
    </>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run build:all && npm run lint -w client`
Expected: clean. If `ContextMenu` is not re-exported from `components/primitives/index.js`, keep the direct-path import as written above.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/ui/KeepAwakeButton.tsx
git commit -m "feat(client): keep-awake toolbar button with countdown pill"
```

---

### Task 11: Mount the CTA in the toolbar

**Files:**
- Modify: `client/src/app/ui/ElectronToolbar.tsx` — props interface (`:36-47`), render before the Remote Access `Tooltip` (`:113`)
- Modify: `client/src/app/ArgusApp.tsx` — hook call next to `useNgrok` (`:157`), props at the `ElectronToolbar` usage (`:548-559`)

**Interfaces:**
- Consumes: `KeepAwakeButton` (Task 10), `useKeepAwake` (Task 9).
- Produces: the CTA visible in the running app.

- [ ] **Step 1: Extend `ElectronToolbar`**

Add the import:

```tsx
import { KeepAwakeButton } from './KeepAwakeButton.js';
import type { KeepAwakeStatus } from '@argus/shared';
```

Add to `ElectronToolbarProps`:

```tsx
  keepAwakeStatus: KeepAwakeStatus | null;
  onArmKeepAwake: (durationMs: number | null) => void;
  onDisarmKeepAwake: () => void;
```

Destructure them in the component signature, then render immediately **before** the `<Tooltip content="Remote Access">` block (`:113`):

```tsx
        <KeepAwakeButton
          status={keepAwakeStatus}
          onArm={onArmKeepAwake}
          onDisarm={onDisarmKeepAwake}
        />
```

- [ ] **Step 2: Wire `ArgusApp`**

Add the import beside `useNgrok`:

```tsx
import { useKeepAwake } from '../hooks/useKeepAwake.js';
```

Call it next to `const ngrok = useNgrok(socket);` (`:157`):

```tsx
  const keepAwake = useKeepAwake(socket);
```

Pass the three props in the `ElectronToolbar` usage (`:548`):

```tsx
        keepAwakeStatus={keepAwake.status}
        onArmKeepAwake={keepAwake.arm}
        onDisarmKeepAwake={keepAwake.disarm}
```

- [ ] **Step 3: Check the second `ElectronToolbar`-adjacent usage**

`ngrokConnected` also appears at `ArgusApp.tsx:605`. Confirm whether that is a second `ElectronToolbar` or a different component:

Run: `sed -n 595,615p client/src/app/ArgusApp.tsx`

If it is another `ElectronToolbar`, pass the same three props there too. If it is a different component (e.g. a mobile or overlay header), leave it alone — mobile is out of scope.

- [ ] **Step 4: Verify**

Run: `npm run build:all && npm run lint -w client && npm test`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/ui/ElectronToolbar.tsx client/src/app/ArgusApp.tsx
git commit -m "feat(client): mount keep-awake CTA in the Electron toolbar"
```

---

### Task 12: End-to-end verification

**Files:** none modified — this task is verification only.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Full CI-equivalent run**

Run: `npm run lint -w client && npm run build:all && npm test`
Expected: all three clean — this is exactly what `.github/workflows/ci.yml` gates on.

- [ ] **Step 2: Launch the app**

Run: `npm run dev`
Expected: Electron window opens. A coffee icon sits immediately left of the globe in the title bar.

- [ ] **Step 3: Walk the states**

1. Hover the coffee icon → tooltip "Keep Mac awake". Confirm the icon is the same size and color as the globe beside it.
2. Click it → menu with header "Keep awake", seven durations with `5m…∞` shorthands, no "Turn off" row.
3. Pick **5 minutes** → the button becomes an amber pill counting down from `5:00`. Watch it for ~10 seconds: digits change, the pill's width does not.
4. Re-open the menu → header reads `Keep awake · 4:5x left`; a red "Turn off" row is now present.
5. Confirm the OS assertion in another shell:

```bash
pmset -g assertions | grep -i -E "PreventUserIdleDisplaySleep|PreventUserIdleSystemSleep"
```

Expected: an assertion attributed to Argus/Electron.

6. Pick **Indefinitely** → pill shows `∞`; assertion still held.
7. Click "Turn off" → back to the plain icon; re-run the `pmset` command and confirm the assertion is gone.
8. Arm **5 minutes**, then start a shell and let it run; stop the keep-awake window via "Turn off". Confirm via `pmset` that an assertion is **still** held (the running shell's) — this is the arbitration regression, verified in the real app.
9. Arm **5 minutes**, then `Cmd+R` to reload the renderer. Expected: the pill comes back with the correct remaining time (state lives on the server, not in the renderer).
10. Arm **5 minutes**, quit the app. Relaunch. Expected: no pill — the window is deliberately not persisted.

- [ ] **Step 4: Fix anything the walkthrough surfaced, then commit**

```bash
git add -A
git commit -m "fix(keep-awake): address end-to-end verification findings"
```

(Skip this commit if the walkthrough was clean.)

- [ ] **Step 5: Hand off**

Report which of the 10 walkthrough steps passed. Do **not** bump the version or tag a release — releasing is a separate, explicit step (`CLAUDE.md` → "How to release a new version").

---

## Notes for the implementer

- `docs/solutions/` has documented gotchas for this codebase. Two apply here: never use `mock.timers` (it hangs), and any **new runtime dependency** must be added to the **root** `package.json` or the packaged app crashes with `ERR_MODULE_NOT_FOUND`. This plan adds no dependency, so the second is only relevant if you deviate.
- The spec's testing section listed a `KeepAwakeButton` render test and a `useKeepAwake` test. Both are intentionally dropped here: the repo has no `@testing-library/react`, and adding it is a bigger decision than this feature. The behavior is instead covered by Task 8 (all formatting), Task 4 (all arm/disarm/expiry semantics), and Task 12 step 3 (the UI itself, by hand).
- `SessionManager` and `NgrokService` each held their **own** OS blocker before Task 2. Collapsing them into one shared blocker is a real behavior change, which is why Task 2 ships its own regression test and Task 12 step 3.8 re-verifies it in the running app.
