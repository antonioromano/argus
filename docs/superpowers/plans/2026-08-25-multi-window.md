# Multi-Window Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multiple full Argus desktop windows over one server, with exclusive per-window session ownership, explicit move/merge gestures, and full restart restore.

**Architecture:** Server-owned window registry (new `WindowStore` persistence + `WindowRegistry` service + `/api/windows` routes, `window:state` socket broadcast) is the single source of truth. The Electron main process turns its window singleton into a `Map<windowId, BrowserWindow>` driven by injected server callbacks (same pattern as `setPickFolderFn`). The renderer reads its `windowId` from the URL; sessions owned by other windows are forced into the minimized-chip row with a window badge.

**Tech Stack:** TypeScript strict ESM everywhere; Express + Socket.io + `node:test` (server); React + Vitest (client); Electron main (no test harness — typecheck + manual smoke).

**Spec:** `docs/superpowers/specs/2026-08-25-multi-window-design.md`

## Global Constraints

- TypeScript strict mode, ES2022, ESM. Server imports use `.js` extensions (ESM resolution requirement).
- **No new runtime dependencies.** (If one ever becomes necessary it MUST also go in the ROOT `package.json` — packaged app crashes otherwise. None is needed for this plan.)
- Main window has the fixed id `'main'` (`MAIN_WINDOW_ID` shared constant). It always exists and is never deletable.
- A session absent from `assignments` belongs to the main window.
- Server data files live in `ARGUS_DATA_DIR`; the new file is `windows.json` (add nothing to git — `server/data/` is already gitignored).
- Run tests with `npm test -w server` / `npm test -w client`; typecheck with `npm run build:all`; lint with `npm run lint -w client`. CI gates merges — keep all three green.
- No version bump in this plan (done at release time per CLAUDE.md).
- Commit after every task with a conventional-commit message.

---

### Task 1: Shared types + socket event

**Files:**
- Modify: `shared/src/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MAIN_WINDOW_ID: 'main'`, `interface ArgusWindow { id: string; label: string; isMain: boolean; createdAt: number }`, `interface WindowRegistryState { windows: ArgusWindow[]; assignments: Record<string, string> }`, and the `'window:state'` entry in `ServerToClientEvents`. Every later task imports these from `@argus/shared`.

- [ ] **Step 1: Add the types**

In `shared/src/types.ts`, next to the group types (near `GetGroupsResponse`), add:

```ts
// ---- Multi-window ----

/** Fixed id of the primary window. Sessions with no assignment belong here. */
export const MAIN_WINDOW_ID = 'main';

export interface ArgusWindow {
  /** 'main' for the primary window, crypto.randomUUID() otherwise. */
  id: string;
  /** 'Main', 'Window 2', … */
  label: string;
  isMain: boolean;
  createdAt: number;
}

/** Full window registry snapshot — windows plus sessionId → windowId assignments.
 *  A session absent from `assignments` belongs to the main window. */
export interface WindowRegistryState {
  windows: ArgusWindow[];
  assignments: Record<string, string>;
}
```

In `ServerToClientEvents` (after `'keepawake:status'`), add:

```ts
  /** Broadcast on every window-registry mutation (create/delete/assign/merge). */
  'window:state': (state: WindowRegistryState) => void;
```

- [ ] **Step 2: Typecheck**

Run: `npm run build:all`
Expected: PASS (types compile; nothing consumes them yet).

- [ ] **Step 3: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(shared): window registry types and window:state event"
```

---

### Task 2: WindowStore persistence

**Files:**
- Create: `server/src/persistence/WindowStore.ts`
- Test: `server/src/persistence/WindowStore.test.ts`

**Interfaces:**
- Consumes: `WindowRegistryState`, `MAIN_WINDOW_ID` from `@argus/shared`; `atomicWrite` from `../utils/atomicWrite.js`.
- Produces: `class WindowStore { constructor(filePath: string); load(): Promise<WindowRegistryState>; save(state: WindowRegistryState): Promise<void> }`. `load()` NEVER throws — missing/corrupt file yields the default state `{ windows: [main], assignments: {} }`.

- [ ] **Step 1: Write the failing tests**

`server/src/persistence/WindowStore.test.ts` (mirror `GroupStore.test.ts` structure):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAIN_WINDOW_ID, type WindowRegistryState } from '@argus/shared';
import { WindowStore } from './WindowStore.js';

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'argus-winstore-test-'));
}

const state: WindowRegistryState = {
  windows: [
    { id: MAIN_WINDOW_ID, label: 'Main', isMain: true, createdAt: 1 },
    { id: 'w2', label: 'Window 2', isMain: false, createdAt: 2 },
  ],
  assignments: { s1: 'w2' },
};

test('round-trips state through save and load', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new WindowStore(path.join(dir, 'windows.json'));
  await store.save(state);
  assert.deepEqual(await store.load(), state);
});

test('missing file yields default state with main window only', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new WindowStore(path.join(dir, 'missing.json'));
  const loaded = await store.load();
  assert.equal(loaded.windows.length, 1);
  assert.equal(loaded.windows[0].id, MAIN_WINDOW_ID);
  assert.equal(loaded.windows[0].isMain, true);
  assert.deepEqual(loaded.assignments, {});
});

test('corrupt JSON yields default state (no throw)', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'windows.json');
  writeFileSync(file, '{ not json', 'utf-8');
  const store = new WindowStore(file);
  const loaded = await store.load();
  assert.equal(loaded.windows[0].id, MAIN_WINDOW_ID);
});

test('load tolerates a file missing fields (partial JSON object)', async (t) => {
  const dir = tmpDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'windows.json');
  writeFileSync(file, '{}', 'utf-8');
  const store = new WindowStore(file);
  const loaded = await store.load();
  assert.equal(loaded.windows[0].id, MAIN_WINDOW_ID);
  assert.deepEqual(loaded.assignments, {});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — cannot find module `./WindowStore.js`.

- [ ] **Step 3: Implement WindowStore**

`server/src/persistence/WindowStore.ts`:

```ts
import { readFile } from 'fs/promises';
import { MAIN_WINDOW_ID, type ArgusWindow, type WindowRegistryState } from '@argus/shared';
import { atomicWrite } from '../utils/atomicWrite.js';

function defaultState(): WindowRegistryState {
  const main: ArgusWindow = { id: MAIN_WINDOW_ID, label: 'Main', isMain: true, createdAt: Date.now() };
  return { windows: [main], assignments: {} };
}

export class WindowStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async save(state: WindowRegistryState): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(state, null, 2));
  }

  async load(): Promise<WindowRegistryState> {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data) as Partial<WindowRegistryState>;
      const windows = Array.isArray(parsed.windows) ? parsed.windows : [];
      const assignments =
        parsed.assignments && typeof parsed.assignments === 'object' ? parsed.assignments : {};
      if (!windows.some((w) => w.id === MAIN_WINDOW_ID)) {
        windows.unshift(defaultState().windows[0]);
      }
      return { windows, assignments };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[WindowStore] Failed to load windows:', err);
      }
      return defaultState();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS (all four new tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/persistence/WindowStore.ts server/src/persistence/WindowStore.test.ts
git commit -m "feat(server): WindowStore persistence for the window registry"
```

---

### Task 3: WindowRegistry service

**Files:**
- Create: `server/src/services/WindowRegistry.ts`
- Test: `server/src/services/WindowRegistry.test.ts`

**Interfaces:**
- Consumes: `WindowStore` (Task 2), shared types (Task 1).
- Produces:

```ts
class WindowRegistry {
  constructor(store: WindowStore);
  init(): Promise<void>;                       // load from store, ensure main
  getState(): WindowRegistryState;             // defensive copy
  onChange(cb: (s: WindowRegistryState) => void): void;
  ownerOf(sessionId: string): string;          // assignments[id] ?? MAIN_WINDOW_ID
  createWindow(sessionId?: string): Promise<ArgusWindow>;
  deleteWindow(id: string): Promise<boolean>;  // false on main / unknown; sessions merge to main
  assign(sessionId: string, windowId: string): Promise<boolean>; // false on unknown window
  mergeAll(targetId: string, allSessionIds: string[]): Promise<string[] | null>;
    // null on unknown target; else the ids of windows deleted by the merge
  removeSession(sessionId: string): Promise<void>;   // called on session deletion
  pruneToSessions(validIds: Set<string>): Promise<void>; // drop dangling assignments
}
```

- [ ] **Step 1: Write the failing tests**

`server/src/services/WindowRegistry.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAIN_WINDOW_ID, type WindowRegistryState } from '@argus/shared';
import { WindowStore } from '../persistence/WindowStore.js';
import { WindowRegistry } from './WindowRegistry.js';

async function makeRegistry(t: { after: (fn: () => void) => void }): Promise<WindowRegistry> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-winreg-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const reg = new WindowRegistry(new WindowStore(path.join(dir, 'windows.json')));
  await reg.init();
  return reg;
}

test('init yields main window; ownerOf defaults to main', async (t) => {
  const reg = await makeRegistry(t);
  assert.equal(reg.getState().windows[0].id, MAIN_WINDOW_ID);
  assert.equal(reg.ownerOf('unknown-session'), MAIN_WINDOW_ID);
});

test('createWindow assigns optional session and labels sequentially', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  assert.equal(w2.label, 'Window 2');
  assert.equal(reg.ownerOf('s1'), w2.id);
  const w3 = await reg.createWindow();
  assert.equal(w3.label, 'Window 3');
});

test('deleteWindow merges its sessions back to main; main is not deletable', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  assert.equal(await reg.deleteWindow(w2.id), true);
  assert.equal(reg.ownerOf('s1'), MAIN_WINDOW_ID);
  assert.equal(reg.getState().windows.length, 1);
  assert.equal(await reg.deleteWindow(MAIN_WINDOW_ID), false);
  assert.equal(await reg.deleteWindow('nope'), false);
});

test('assign moves a session; assigning to main clears the entry; unknown window fails', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow();
  assert.equal(await reg.assign('s1', w2.id), true);
  assert.equal(reg.ownerOf('s1'), w2.id);
  assert.equal(await reg.assign('s1', MAIN_WINDOW_ID), true);
  assert.deepEqual(reg.getState().assignments, {});
  assert.equal(await reg.assign('s1', 'nope'), false);
});

test('mergeAll pulls every session to the target and deletes emptied windows', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  const w3 = await reg.createWindow('s2');
  const removed = await reg.mergeAll(w2.id, ['s1', 's2', 's3']);
  assert.deepEqual(removed, [w3.id]);
  assert.equal(reg.ownerOf('s1'), w2.id);
  assert.equal(reg.ownerOf('s2'), w2.id);
  assert.equal(reg.ownerOf('s3'), w2.id);
  // main survives even when empty
  assert.ok(reg.getState().windows.some((w) => w.id === MAIN_WINDOW_ID));
  assert.equal(await reg.mergeAll('nope', []), null);
});

test('mergeAll to main empties assignments entirely', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  const removed = await reg.mergeAll(MAIN_WINDOW_ID, ['s1']);
  assert.deepEqual(removed, [w2.id]);
  assert.deepEqual(reg.getState().assignments, {});
});

test('removeSession and pruneToSessions drop assignments', async (t) => {
  const reg = await makeRegistry(t);
  const w2 = await reg.createWindow('s1');
  await reg.assign('s2', w2.id);
  await reg.removeSession('s1');
  assert.equal(reg.ownerOf('s1'), MAIN_WINDOW_ID);
  await reg.pruneToSessions(new Set([]));
  assert.deepEqual(reg.getState().assignments, {});
});

test('onChange fires with a snapshot on every mutation', async (t) => {
  const reg = await makeRegistry(t);
  const seen: WindowRegistryState[] = [];
  reg.onChange((s) => seen.push(s));
  const w2 = await reg.createWindow('s1');
  await reg.deleteWindow(w2.id);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].windows.length, 1);
});

test('state survives a reload through the store', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'argus-winreg-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'windows.json');
  const reg1 = new WindowRegistry(new WindowStore(file));
  await reg1.init();
  const w2 = await reg1.createWindow('s1');
  const reg2 = new WindowRegistry(new WindowStore(file));
  await reg2.init();
  assert.equal(reg2.ownerOf('s1'), w2.id);
  assert.equal(reg2.getState().windows.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — cannot find module `./WindowRegistry.js`.

- [ ] **Step 3: Implement WindowRegistry**

`server/src/services/WindowRegistry.ts`:

```ts
import { randomUUID } from 'crypto';
import { MAIN_WINDOW_ID, type ArgusWindow, type WindowRegistryState } from '@argus/shared';
import type { WindowStore } from '../persistence/WindowStore.js';

/** 'Window N' where N is one past the highest existing numeric label (main is window 1). */
function nextLabel(windows: ArgusWindow[]): string {
  const nums = windows
    .map((w) => /^Window (\d+)$/.exec(w.label)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  return `Window ${Math.max(1, ...nums) + 1}`;
}

/**
 * Source of truth for windows + session→window assignments. All mutations
 * persist through the store and notify listeners with a fresh snapshot
 * (index.ts wires listeners to the socket broadcast).
 */
export class WindowRegistry {
  private state: WindowRegistryState = { windows: [], assignments: {} };
  private listeners: Array<(s: WindowRegistryState) => void> = [];

  constructor(private store: WindowStore) {}

  async init(): Promise<void> {
    this.state = await this.store.load(); // store guarantees main exists
  }

  getState(): WindowRegistryState {
    return {
      windows: this.state.windows.map((w) => ({ ...w })),
      assignments: { ...this.state.assignments },
    };
  }

  onChange(cb: (s: WindowRegistryState) => void): void {
    this.listeners.push(cb);
  }

  ownerOf(sessionId: string): string {
    return this.state.assignments[sessionId] ?? MAIN_WINDOW_ID;
  }

  private async commit(): Promise<void> {
    await this.store.save(this.state);
    const snap = this.getState();
    for (const cb of this.listeners) cb(snap);
  }

  async createWindow(sessionId?: string): Promise<ArgusWindow> {
    const win: ArgusWindow = {
      id: randomUUID(),
      label: nextLabel(this.state.windows),
      isMain: false,
      createdAt: Date.now(),
    };
    this.state.windows.push(win);
    if (sessionId) this.state.assignments[sessionId] = win.id;
    await this.commit();
    return win;
  }

  async deleteWindow(id: string): Promise<boolean> {
    if (id === MAIN_WINDOW_ID) return false;
    if (!this.state.windows.some((w) => w.id === id)) return false;
    this.state.windows = this.state.windows.filter((w) => w.id !== id);
    // Its sessions fall back to main (default assignment = absent entry).
    for (const [sid, wid] of Object.entries(this.state.assignments)) {
      if (wid === id) delete this.state.assignments[sid];
    }
    await this.commit();
    return true;
  }

  async assign(sessionId: string, windowId: string): Promise<boolean> {
    if (!this.state.windows.some((w) => w.id === windowId)) return false;
    if (windowId === MAIN_WINDOW_ID) delete this.state.assignments[sessionId];
    else this.state.assignments[sessionId] = windowId;
    await this.commit();
    return true;
  }

  async mergeAll(targetId: string, allSessionIds: string[]): Promise<string[] | null> {
    if (!this.state.windows.some((w) => w.id === targetId)) return null;
    this.state.assignments = {};
    if (targetId !== MAIN_WINDOW_ID) {
      for (const sid of allSessionIds) this.state.assignments[sid] = targetId;
    }
    const removed = this.state.windows
      .filter((w) => !w.isMain && w.id !== targetId)
      .map((w) => w.id);
    this.state.windows = this.state.windows.filter((w) => w.isMain || w.id === targetId);
    await this.commit();
    return removed;
  }

  async removeSession(sessionId: string): Promise<void> {
    if (sessionId in this.state.assignments) {
      delete this.state.assignments[sessionId];
      await this.commit();
    }
  }

  async pruneToSessions(validIds: Set<string>): Promise<void> {
    let changed = false;
    for (const sid of Object.keys(this.state.assignments)) {
      if (!validIds.has(sid)) {
        delete this.state.assignments[sid];
        changed = true;
      }
    }
    if (changed) await this.commit();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/WindowRegistry.ts server/src/services/WindowRegistry.test.ts
git commit -m "feat(server): WindowRegistry service with ownership invariants"
```

---

### Task 4: /api/windows routes

**Files:**
- Create: `server/src/routes/windows.ts`
- Test: `server/src/routes/windows.test.ts`

**Interfaces:**
- Consumes: `WindowRegistry` (Task 3).
- Produces:

```ts
export interface WindowHostHooks {
  onCreate?: (id: string) => void;  // Electron opens a BrowserWindow
  onClose?: (id: string) => void;   // Electron destroys a BrowserWindow
  onFocus?: (id: string) => void;   // Electron shows+focuses a BrowserWindow
}
export function createWindowRoutes(
  registry: WindowRegistry,
  listSessionIds: () => string[],
  hooks: WindowHostHooks,
): Router;
```

Routes: `GET /` → `WindowRegistryState`; `POST /` `{ sessionId? }` → 201 `ArgusWindow` (404 unknown session); `DELETE /:id` → `{ ok: true }` (400 on main, 404 unknown); `PUT /assign` `{ sessionId, windowId }` → state (404 unknown session/window); `POST /:id/merge-all` → state (404 unknown window); `POST /:id/focus` → `{ ok: true }` (404 unknown window, no state change).

- [ ] **Step 1: Write the failing tests**

`server/src/routes/windows.test.ts` (integration over a real express app — `config.test.ts` pattern):

```ts
import { test, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { MAIN_WINDOW_ID, type ArgusWindow, type WindowRegistryState } from '@argus/shared';
import { WindowStore } from '../persistence/WindowStore.js';
import { WindowRegistry } from '../services/WindowRegistry.js';
import { createWindowRoutes, type WindowHostHooks } from './windows.js';

let dir: string;
let registry: WindowRegistry;
let server: Server;
let base: string;
let hookCalls: string[];
const sessionIds = ['s1', 's2'];

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'argus-winroutes-test-'));
  registry = new WindowRegistry(new WindowStore(join(dir, 'windows.json')));
  await registry.init();
  hookCalls = [];
  const hooks: WindowHostHooks = {
    onCreate: (id) => hookCalls.push(`create:${id}`),
    onClose: (id) => hookCalls.push(`close:${id}`),
    onFocus: (id) => hookCalls.push(`focus:${id}`),
  };
  const app = express();
  app.use(express.json());
  app.use('/windows', createWindowRoutes(registry, () => sessionIds, hooks));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/windows`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  // Reset: merge everything into main (removes secondaries) and clear hook log.
  await registry.mergeAll(MAIN_WINDOW_ID, sessionIds);
  hookCalls = [];
});

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as never };
}

test('GET / returns the registry state', async () => {
  const { status, body } = await req('GET', '');
  assert.equal(status, 200);
  const state = body as WindowRegistryState;
  assert.equal(state.windows[0].id, MAIN_WINDOW_ID);
});

test('POST / creates a window (optionally claiming a session) and fires onCreate', async () => {
  const { status, body } = await req('POST', '', { sessionId: 's1' });
  assert.equal(status, 201);
  const win = body as ArgusWindow;
  assert.equal(registry.ownerOf('s1'), win.id);
  assert.deepEqual(hookCalls, [`create:${win.id}`]);
});

test('POST / with an unknown session is a 404', async () => {
  const { status } = await req('POST', '', { sessionId: 'ghost' });
  assert.equal(status, 404);
});

test('DELETE /:id merges sessions back and fires onClose; main is 400', async () => {
  const w = await registry.createWindow('s1');
  hookCalls = [];
  const { status } = await req('DELETE', `/${w.id}`);
  assert.equal(status, 200);
  assert.equal(registry.ownerOf('s1'), MAIN_WINDOW_ID);
  assert.deepEqual(hookCalls, [`close:${w.id}`]);
  assert.equal((await req('DELETE', `/${MAIN_WINDOW_ID}`)).status, 400);
  assert.equal((await req('DELETE', '/nope')).status, 404);
});

test('PUT /assign moves a session; unknown session or window is 404', async () => {
  const w = await registry.createWindow();
  const { status } = await req('PUT', '/assign', { sessionId: 's2', windowId: w.id });
  assert.equal(status, 200);
  assert.equal(registry.ownerOf('s2'), w.id);
  assert.equal((await req('PUT', '/assign', { sessionId: 'ghost', windowId: w.id })).status, 404);
  assert.equal((await req('PUT', '/assign', { sessionId: 's1', windowId: 'nope' })).status, 404);
});

test('POST /:id/merge-all gathers all sessions and fires onClose per removed window', async () => {
  const w2 = await registry.createWindow('s1');
  const w3 = await registry.createWindow('s2');
  hookCalls = [];
  const { status } = await req('POST', `/${w2.id}/merge-all`);
  assert.equal(status, 200);
  assert.equal(registry.ownerOf('s2'), w2.id);
  assert.deepEqual(hookCalls, [`close:${w3.id}`]);
  assert.equal((await req('POST', '/nope/merge-all')).status, 404);
});

test('POST /:id/focus fires onFocus without changing state', async () => {
  const { status } = await req('POST', `/${MAIN_WINDOW_ID}/focus`);
  assert.equal(status, 200);
  assert.deepEqual(hookCalls, [`focus:${MAIN_WINDOW_ID}`]);
  assert.equal((await req('POST', '/nope/focus')).status, 404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w server`
Expected: FAIL — cannot find module `./windows.js`.

- [ ] **Step 3: Implement the routes**

`server/src/routes/windows.ts`:

```ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { WindowRegistry } from '../services/WindowRegistry.js';

/** Callbacks into the Electron host (open/close/focus BrowserWindows).
 *  All optional — the plain-node `dev:web` server runs without a host. */
export interface WindowHostHooks {
  onCreate?: (id: string) => void;
  onClose?: (id: string) => void;
  onFocus?: (id: string) => void;
}

/**
 * Window registry CRUD. Mounted behind the bearer-auth middleware like every
 * other API route. No filesystem paths involved, so pathScope does not apply.
 */
export function createWindowRoutes(
  registry: WindowRegistry,
  listSessionIds: () => string[],
  hooks: WindowHostHooks,
): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(registry.getState());
  });

  router.post('/', asyncHandler(async (req, res) => {
    const sessionId = (req.body ?? {}).sessionId as string | undefined;
    if (sessionId !== undefined && !listSessionIds().includes(sessionId)) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }
    const win = await registry.createWindow(sessionId);
    hooks.onCreate?.(win.id);
    res.status(201).json(win);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!registry.getState().windows.some((w) => w.id === id)) {
      res.status(404).json({ error: 'Window not found' });
      return;
    }
    const ok = await registry.deleteWindow(id);
    if (!ok) {
      res.status(400).json({ error: 'The main window cannot be deleted' });
      return;
    }
    hooks.onClose?.(id);
    res.json({ ok: true });
  }));

  router.put('/assign', asyncHandler(async (req, res) => {
    const { sessionId, windowId } = (req.body ?? {}) as { sessionId?: string; windowId?: string };
    if (typeof sessionId !== 'string' || typeof windowId !== 'string') {
      res.status(400).json({ error: 'sessionId and windowId are required' });
      return;
    }
    if (!listSessionIds().includes(sessionId)) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }
    const ok = await registry.assign(sessionId, windowId);
    if (!ok) {
      res.status(404).json({ error: 'Window not found' });
      return;
    }
    res.json(registry.getState());
  }));

  router.post('/:id/merge-all', asyncHandler(async (req, res) => {
    const removed = await registry.mergeAll(req.params.id, listSessionIds());
    if (removed === null) {
      res.status(404).json({ error: 'Window not found' });
      return;
    }
    for (const id of removed) hooks.onClose?.(id);
    res.json(registry.getState());
  }));

  router.post('/:id/focus', (req, res) => {
    const { id } = req.params;
    if (!registry.getState().windows.some((w) => w.id === id)) {
      res.status(404).json({ error: 'Window not found' });
      return;
    }
    hooks.onFocus?.(id);
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/windows.ts server/src/routes/windows.test.ts
git commit -m "feat(server): /api/windows routes with host hooks"
```

---

### Task 5: Server wiring (index.ts + session-deletion hook)

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/src/services/SessionManager.ts` (one property + one call)

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces (new exports from `server/src/index.ts`, consumed by Electron in Task 7):

```ts
export function setWindowHooks(h: WindowHostHooks): void;
export function getWindowRegistryState(): WindowRegistryState;
export async function hostCreateWindow(): Promise<void>;          // menu "New Window"
export async function hostDeleteWindow(id: string): Promise<void>; // secondary window red button
export async function hostMergeAll(targetId: string): Promise<void>; // menu "Merge All Windows"
```

Also: `SessionManager` gains `onSessionDeleted?: (id: string) => void`.

- [ ] **Step 1: Add the SessionManager deletion hook**

In `server/src/services/SessionManager.ts`, add a public property near the other injected collaborators (e.g. next to `setIo`):

```ts
  /** Invoked after a session is fully deleted — index.ts wires this to the
   *  window registry so the deleted session's window assignment is dropped. */
  onSessionDeleted?: (id: string) => void;
```

In `deleteSession`, immediately after `this.io?.emit('session:deleted', { sessionId: id });` (currently `SessionManager.ts:688`), add:

```ts
    this.onSessionDeleted?.(id);
```

- [ ] **Step 2: Wire the registry in index.ts**

In `server/src/index.ts`:

Imports:

```ts
import { WindowStore } from './persistence/WindowStore.js';
import { WindowRegistry } from './services/WindowRegistry.js';
import { createWindowRoutes, type WindowHostHooks } from './routes/windows.js';
import type { WindowRegistryState } from '@argus/shared';
```

Instantiation (near the other stores, after `groupStore`):

```ts
// Window registry — source of truth for multi-window ownership.
const windowStore = new WindowStore(path.join(dataDir, 'windows.json'));
const windowRegistry = new WindowRegistry(windowStore);
windowRegistry.onChange((state) => io.emit('window:state', state));
sessionManager.onSessionDeleted = (id) => {
  void windowRegistry.removeSession(id).catch(console.error);
};

// Electron host callbacks — mutable so the host can set them before/after
// startServer (same pattern as _filesystemOptions).
const _windowHooks: WindowHostHooks = {};
export function setWindowHooks(h: WindowHostHooks): void {
  Object.assign(_windowHooks, h);
}
export function getWindowRegistryState(): WindowRegistryState {
  return windowRegistry.getState();
}
// In-process entry points for the Electron host (menu items, red-button close).
export async function hostCreateWindow(): Promise<void> {
  const win = await windowRegistry.createWindow();
  _windowHooks.onCreate?.(win.id);
}
export async function hostDeleteWindow(id: string): Promise<void> {
  if (await windowRegistry.deleteWindow(id)) _windowHooks.onClose?.(id);
}
export async function hostMergeAll(targetId: string): Promise<void> {
  const removed = await windowRegistry.mergeAll(
    targetId,
    sessionManager.getAllSessions().map((s) => s.id),
  );
  for (const id of removed ?? []) _windowHooks.onClose?.(id);
}
```

Route mount (with the other routes):

```ts
app.use('/api/windows', createWindowRoutes(
  windowRegistry,
  () => sessionManager.getAllSessions().map((s) => s.id),
  _windowHooks,
));
```

In `startServer()`, before `httpServer.listen` (right after `applyConfig`):

```ts
  await windowRegistry.init();
```

And extend the background restore so dangling assignments are pruned once sessions are known — replace:

```ts
  void sessionManager.restoreSessions().catch((err) => {
    console.error('Failed to restore sessions:', err);
  });
```

with:

```ts
  void sessionManager
    .restoreSessions()
    .then(() =>
      windowRegistry.pruneToSessions(
        new Set(sessionManager.getAllSessions().map((s) => s.id)),
      ),
    )
    .catch((err) => {
      console.error('Failed to restore sessions:', err);
    });
```

- [ ] **Step 3: Typecheck + full server tests**

Run: `npm run build:all && npm test -w server`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts server/src/services/SessionManager.ts
git commit -m "feat(server): wire window registry — routes, broadcast, host exports, prune on restore"
```

---

### Task 6: Electron WindowManager (window.ts refactor)

**Files:**
- Modify: `electron/src/window.ts` (rewrite: singleton → manager)

**Interfaces:**
- Consumes: nothing new (Electron APIs only).
- Produces (new module surface; main.ts updated in Task 7):

```ts
export function createAppWindow(windowId: string): BrowserWindow;
export function destroyAppWindow(windowId: string): void;   // bypasses the close handler
export function focusAppWindow(windowId: string): void;     // falls back to main if unknown
export function getAppWindow(windowId: string): BrowserWindow | null;
export function getMainWindow(): BrowserWindow | null;
export function getFocusedWindowId(): string;                // focused window's id, or 'main'
export function showWindow(): void;                          // show+focus MAIN (existing callers)
export function saveAllWindowStates(): void;
export function setSecondaryCloseHandler(fn: (windowId: string) => void): void;
export function setZoomLevelForFocused(level: number): void;
export function getZoomLevelForFocused(): number;
export function setAppQuitting(v: boolean): void;            // unchanged
export function setStopAllOnQuit(v: boolean): void;          // unchanged
export function getStopAllOnQuit(): boolean;                 // unchanged
```

Removed: `createWindow()`, `getWindow()`, `saveWindowState()`, `setZoomLevel()`, `getZoomLevel()` (call sites migrate in Task 7 — the two tasks land as consecutive commits; the tree only typechecks after Task 7, so run the Task 6/7 typecheck at the end of Task 7).

- [ ] **Step 1: Rewrite window.ts**

Keep all existing behavior (state clamping, hiddenInset, sandbox webPreferences, external-link routing, hide-on-close for MAIN) but generalize. Key structure:

```ts
import { BrowserWindow, app, shell, screen } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_WINDOW_ID = 'main'; // mirror of @argus/shared MAIN_WINDOW_ID (electron avoids the runtime dep)

const windows = new Map<string, BrowserWindow>();
const zoomLevels = new Map<string, number>();
// Windows being torn down programmatically (server-initiated) — their 'close'
// event must NOT re-trigger the delete round-trip.
const destroying = new Set<string>();
let appIsQuitting = false;
let stopAllOnQuit = false;
let onSecondaryClose: ((windowId: string) => void) | null = null;

interface PersistedWindowState {
  fullscreen: boolean;
  displayId: number;
  bounds: { x: number; y: number; width: number; height: number };
  zoomLevel?: number;
}
// windowId → state. Legacy (pre-multi-window) file was a single PersistedWindowState.
type WindowStateFile = Record<string, PersistedWindowState>;

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadWindowStates(): WindowStateFile {
  try {
    const parsed = JSON.parse(readFileSync(windowStatePath(), 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && 'bounds' in (parsed as object)) {
      // Legacy single-window shape → migrate as the main window's state.
      return { [MAIN_WINDOW_ID]: parsed as PersistedWindowState };
    }
    return (parsed as WindowStateFile) ?? {};
  } catch {
    return {};
  }
}

export function saveAllWindowStates(): void {
  const states = loadWindowStates(); // keep entries for windows not currently open
  for (const [id, win] of windows) {
    if (win.isDestroyed()) continue;
    states[id] = {
      fullscreen: win.isFullScreen(),
      displayId: screen.getDisplayMatching(win.getBounds()).id,
      bounds: win.getNormalBounds(),
      zoomLevel: zoomLevels.get(id) ?? 0,
    };
  }
  try {
    writeFileSync(windowStatePath(), JSON.stringify(states));
  } catch { /* non-critical */ }
}

export function setSecondaryCloseHandler(fn: (windowId: string) => void): void {
  onSecondaryClose = fn;
}
```

`createAppWindow(windowId)` reuses the existing body of `createWindow()` with these deltas:
- Restore state from `loadWindowStates()[windowId]` (same display-resolution + clamping logic as today).
- `zoomLevels.set(windowId, saved?.zoomLevel ?? 0)` and re-apply on `did-finish-load` from `zoomLevels.get(windowId)`.
- Load URL: `` win.loadURL(`http://127.0.0.1:${port}/?windowId=${windowId}`) ``. `appOrigin` check in `will-navigate` stays prefix-based (`url.startsWith(appOrigin)`) so the query string passes.
- Close handler:

```ts
  win.on('close', (e) => {
    if (appIsQuitting || destroying.has(windowId)) return; // allow real close
    if (windowId === MAIN_WINDOW_ID) {
      // Main: hide, keep app alive (existing behavior).
      e.preventDefault();
      win.hide();
      if (![...windows.values()].some((w) => !w.isDestroyed() && w.isVisible())) {
        app.dock?.hide();
      }
      return;
    }
    // Secondary: real close, but the server owns the decision — it deletes the
    // window record (merging sessions back to main) and calls destroyAppWindow
    // via the onClose host hook.
    e.preventDefault();
    onSecondaryClose?.(windowId);
  });
  win.on('closed', () => {
    windows.delete(windowId);
    zoomLevels.delete(windowId);
    destroying.delete(windowId);
  });
  windows.set(windowId, win);
```

Remaining exports:

```ts
export function destroyAppWindow(windowId: string): void {
  const win = windows.get(windowId);
  if (!win || win.isDestroyed()) return;
  // Persist bounds before teardown so a re-created window with the same id
  // (unlikely but possible) lands where it was.
  saveAllWindowStates();
  destroying.add(windowId);
  win.destroy();
}

export function getAppWindow(windowId: string): BrowserWindow | null {
  const win = windows.get(windowId);
  return win && !win.isDestroyed() ? win : null;
}

export function getMainWindow(): BrowserWindow | null {
  return getAppWindow(MAIN_WINDOW_ID);
}

export function getFocusedWindowId(): string {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) {
    for (const [id, win] of windows) if (win === focused) return id;
  }
  return MAIN_WINDOW_ID;
}

export function focusAppWindow(windowId: string): void {
  const win = getAppWindow(windowId) ?? getMainWindow();
  if (!win) return;
  app.dock?.show();
  win.show();
  win.focus();
}

export function showWindow(): void {
  focusAppWindow(MAIN_WINDOW_ID);
}

export function setZoomLevelForFocused(level: number): void {
  const id = getFocusedWindowId();
  zoomLevels.set(id, level);
  getAppWindow(id)?.webContents.setZoomLevel(level);
}

export function getZoomLevelForFocused(): number {
  return zoomLevels.get(getFocusedWindowId()) ?? 0;
}
```

`setAppQuitting`/`setStopAllOnQuit`/`getStopAllOnQuit` keep their existing bodies.

One behavior note preserved from today: `ready-to-show` → `win.show()` + restore fullscreen + `app.dock?.show()` stays per window.

- [ ] **Step 2: Commit (typecheck deferred to Task 7 — main.ts still references old exports)**

```bash
git add electron/src/window.ts
git commit -m "refactor(electron): window singleton becomes multi-window manager"
```

---

### Task 7: Electron main.ts integration

**Files:**
- Modify: `electron/src/main.ts`

**Interfaces:**
- Consumes: Task 5 server exports (`setWindowHooks`, `getWindowRegistryState`, `hostCreateWindow`, `hostDeleteWindow`, `hostMergeAll`), Task 6 window manager exports.
- Produces: startup restore of all windows; menu items `File → New Window` (Cmd+Shift+N) and `Window → Merge All Windows`; notification clicks routed to the owning window.

- [ ] **Step 1: Update imports and add a server-module ref**

Replace the window.js import with the new surface:

```ts
import {
  createAppWindow, destroyAppWindow, focusAppWindow, getAppWindow, getMainWindow,
  getFocusedWindowId, showWindow, saveAllWindowStates, setSecondaryCloseHandler,
  setZoomLevelForFocused, getZoomLevelForFocused,
  setAppQuitting, setStopAllOnQuit, getStopAllOnQuit,
} from './window.js';
```

Add module-level (near `shutdownServer`):

```ts
// Window-registry entry points, captured from the in-process server in main().
interface WindowRegistryStateLike {
  windows: { id: string; isMain: boolean }[];
  assignments: Record<string, string>;
}
let hostCreateWindowFn: (() => Promise<void>) | null = null;
let hostDeleteWindowFn: ((id: string) => Promise<void>) | null = null;
let hostMergeAllFn: ((targetId: string) => Promise<void>) | null = null;
let getWindowRegistryStateFn: (() => WindowRegistryStateLike) | null = null;
```

- [ ] **Step 2: Wire hooks + startup restore in main()**

After `await server.startServer()` succeeds and the existing getters are captured, add:

```ts
  hostCreateWindowFn = server.hostCreateWindow as () => Promise<void>;
  hostDeleteWindowFn = server.hostDeleteWindow as (id: string) => Promise<void>;
  hostMergeAllFn = server.hostMergeAll as (targetId: string) => Promise<void>;
  getWindowRegistryStateFn = server.getWindowRegistryState as () => WindowRegistryStateLike;

  server.setWindowHooks({
    onCreate: (id: string) => { createAppWindow(id); },
    onClose: (id: string) => { destroyAppWindow(id); },
    onFocus: (id: string) => { focusAppWindow(id); },
  });
  // Secondary red-button close → server deletes the record (sessions merge back
  // to main) → onClose hook destroys the BrowserWindow.
  setSecondaryCloseHandler((id) => { void hostDeleteWindowFn?.(id).catch(console.error); });
```

(If the conditional-type line is awkward in review, use the plain equivalent: `getWindowRegistryStateFn = server.getWindowRegistryState;` with the declared type `(() => WindowRegistryStateLike) | null`.)

Replace the single `createWindow();` call with full restore:

```ts
  // Full restore: one BrowserWindow per persisted registry window. Main first
  // so it exists as fallback focus target.
  const registryState = getWindowRegistryStateFn();
  createAppWindow('main');
  for (const w of registryState.windows) {
    if (!w.isMain) createAppWindow(w.id);
  }
```

- [ ] **Step 3: Retarget menu events, zoom, and notif clicks**

- `sendMenuEvent`:

```ts
function sendMenuEvent(channel: string): void {
  const win = getAppWindow(getFocusedWindowId()) ?? getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel);
}
```

- Zoom menu items: replace `setZoomLevel(0)` / `setZoomLevel(getZoomLevel() ± 0.5)` with `setZoomLevelForFocused(0)` / `setZoomLevelForFocused(getZoomLevelForFocused() ± 0.5)`.

- File menu — add above New Session:

```ts
      {
        label: 'New Window',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => { void hostCreateWindowFn?.().catch(console.error); },
      },
      { type: 'separator' },
```

- Window menu — add before `{ role: 'front' }`:

```ts
      {
        label: 'Merge All Windows',
        click: () => { void hostMergeAllFn?.(getFocusedWindowId()).catch(console.error); },
      },
      { type: 'separator' },
```

- `deliverNotifClick`: route to the owning window:

```ts
function deliverNotifClick(id: string): void {
  const owner = getWindowRegistryStateFn?.().assignments[id] ?? 'main';
  focusAppWindow(owner);
  const win = getAppWindow(owner) ?? getMainWindow();
  if (win && !win.isDestroyed()) {
    const send = () => win.webContents.send('notif:click', id);
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
  }
  runNotifier(
    app.isPackaged ? ['-remove', id, '-sender', 'com.antonio.argus'] : ['-remove', id],
  );
}
```

- The dev Notification fallback's click handler (`notif.on('click', …)` in the `notif:show` handler) similarly: `showWindow(); const win = getMainWindow();` → keep as main (dev fallback only; the terminal-notifier path above is the real one). Just fix the compile: replace its `getWindow()` with `getMainWindow()`.

- `before-quit` → replace `saveWindowState()` with `saveAllWindowStates()`.

- `dialog.showMessageBox` fallback in the quit-confirm block: replace `getWindow()` with `getMainWindow()`.

- [ ] **Step 4: Typecheck**

Run: `npm run build:all`
Expected: PASS — no remaining references to the removed exports (`grep -rn "getWindow()\|saveWindowState\|setZoomLevel(" electron/src` returns nothing stale).

- [ ] **Step 5: Manual smoke (dev)**

Run: `npm run dev`
Verify: app opens ONE main window as before; Cmd+Shift+N opens a second (empty-looking, same session set for now — client ownership lands in Tasks 8–9); red-button on the second window closes it; Cmd+Q quits cleanly; relaunch `npm run dev` reopens both windows (restore).

- [ ] **Step 6: Commit**

```bash
git add electron/src/main.ts
git commit -m "feat(electron): multi-window lifecycle — restore, menus, notif routing, per-window zoom"
```

---

### Task 8: Client foundation — windowId, API methods, useWindows

**Files:**
- Create: `client/src/utils/windowId.ts`
- Create: `client/src/hooks/useWindows.ts`
- Modify: `client/src/services/api.ts`
- Test: `client/src/utils/windowId.test.ts`

**Interfaces:**
- Consumes: shared types (Task 1), `/api/windows` routes (Task 4), `useSocket` socket instance.
- Produces:

```ts
// utils/windowId.ts
export function parseWindowId(search: string): string;   // '?windowId=x' → 'x', else MAIN_WINDOW_ID
export const myWindowId: string;                          // parseWindowId(window.location.search)

// hooks/useWindows.ts
export interface WindowsApi {
  myWindowId: string;
  windows: ArgusWindow[];
  ownerOf: (sessionId: string) => string;
  labelOf: (windowId: string) => string;        // unknown id → 'Main'
  isForeign: (sessionId: string) => boolean;    // ownerOf(id) !== myWindowId
  moveToWindow: (sessionId: string, windowId: string) => Promise<void>;
  moveToNewWindow: (sessionId: string) => Promise<void>;
  mergeAllHere: () => Promise<void>;
  focusWindow: (windowId: string) => Promise<void>;
}
export function useWindows(socket: TypedSocket): WindowsApi;

// services/api.ts additions
getWindows(): Promise<WindowRegistryState>;
createWindow(sessionId?: string): Promise<ArgusWindow>;
assignWindow(sessionId: string, windowId: string): Promise<void>;
mergeAllWindows(targetId: string): Promise<void>;
focusWindow(windowId: string): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

`client/src/utils/windowId.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MAIN_WINDOW_ID } from '@argus/shared';
import { parseWindowId } from './windowId.js';

describe('parseWindowId', () => {
  it('extracts the windowId query param', () => {
    expect(parseWindowId('?windowId=abc-123')).toBe('abc-123');
  });
  it('defaults to main when absent, empty, or malformed', () => {
    expect(parseWindowId('')).toBe(MAIN_WINDOW_ID);
    expect(parseWindowId('?other=1')).toBe(MAIN_WINDOW_ID);
    expect(parseWindowId('?windowId=')).toBe(MAIN_WINDOW_ID);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w client`
Expected: FAIL — cannot resolve `./windowId.js`.

- [ ] **Step 3: Implement windowId util**

`client/src/utils/windowId.ts`:

```ts
import { MAIN_WINDOW_ID } from '@argus/shared';

/** Which Argus window this renderer is. Electron loads each window with
 *  ?windowId=<id>; dev:web and /mobile carry no param and act as main. */
export function parseWindowId(search: string): string {
  const id = new URLSearchParams(search).get('windowId');
  return id || MAIN_WINDOW_ID;
}

export const myWindowId: string =
  typeof window !== 'undefined' ? parseWindowId(window.location.search) : MAIN_WINDOW_ID;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w client`
Expected: PASS.

- [ ] **Step 5: Add API methods**

In `client/src/services/api.ts`, next to `getGroups`/`saveGroups`, add (imports for `WindowRegistryState`, `ArgusWindow` from `@argus/shared`):

```ts
  getWindows: async (): Promise<WindowRegistryState> => {
    const res = await authFetch(`${API_BASE}/windows`);
    await requireOk(res);
    return res.json();
  },

  createWindow: async (sessionId?: string): Promise<ArgusWindow> => {
    const res = await authFetch(`${API_BASE}/windows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionId ? { sessionId } : {}),
    });
    await requireOk(res);
    return res.json();
  },

  assignWindow: async (sessionId: string, windowId: string): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/windows/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, windowId }),
    }));
  },

  mergeAllWindows: async (targetId: string): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/windows/${targetId}/merge-all`, { method: 'POST' }));
  },

  focusWindow: async (windowId: string): Promise<void> => {
    await requireOk(await authFetch(`${API_BASE}/windows/${windowId}/focus`, { method: 'POST' }));
  },
```

(Match the exact `authFetch`/`requireOk` idiom used by the surrounding methods in the file.)

- [ ] **Step 6: Implement useWindows**

`client/src/hooks/useWindows.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { MAIN_WINDOW_ID, type ArgusWindow, type ClientToServerEvents, type ServerToClientEvents, type WindowRegistryState } from '@argus/shared';
import { api } from '../services/api.js';
import { myWindowId } from '../utils/windowId.js';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const EMPTY: WindowRegistryState = { windows: [], assignments: {} };

export interface WindowsApi {
  myWindowId: string;
  windows: ArgusWindow[];
  ownerOf: (sessionId: string) => string;
  labelOf: (windowId: string) => string;
  isForeign: (sessionId: string) => boolean;
  moveToWindow: (sessionId: string, windowId: string) => Promise<void>;
  moveToNewWindow: (sessionId: string) => Promise<void>;
  mergeAllHere: () => Promise<void>;
  focusWindow: (windowId: string) => Promise<void>;
}

export function useWindows(socket: TypedSocket): WindowsApi {
  const [state, setState] = useState<WindowRegistryState>(EMPTY);

  useEffect(() => {
    api.getWindows().then(setState).catch(console.error);
    const onState = (s: WindowRegistryState) => setState(s);
    socket.on('window:state', onState);
    return () => { socket.off('window:state', onState); };
  }, [socket]);

  const ownerOf = useCallback(
    (sessionId: string) => state.assignments[sessionId] ?? MAIN_WINDOW_ID,
    [state],
  );
  const labelOf = useCallback(
    (windowId: string) => state.windows.find((w) => w.id === windowId)?.label ?? 'Main',
    [state],
  );
  const isForeign = useCallback(
    (sessionId: string) => ownerOf(sessionId) !== myWindowId,
    [ownerOf],
  );

  const moveToWindow = useCallback(
    (sessionId: string, windowId: string) => api.assignWindow(sessionId, windowId),
    [],
  );
  const moveToNewWindow = useCallback(
    async (sessionId: string) => { await api.createWindow(sessionId); },
    [],
  );
  const mergeAllHere = useCallback(() => api.mergeAllWindows(myWindowId), []);
  const focusWindow = useCallback((windowId: string) => api.focusWindow(windowId), []);

  return { myWindowId, windows: state.windows, ownerOf, labelOf, isForeign, moveToWindow, moveToNewWindow, mergeAllHere, focusWindow };
}
```

- [ ] **Step 7: Typecheck + client tests**

Run: `npm run build:all && npm test -w client`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/src/utils/windowId.ts client/src/utils/windowId.test.ts client/src/hooks/useWindows.ts client/src/services/api.ts
git commit -m "feat(client): windowId identity, windows API, useWindows hook"
```

---

### Task 9: Ownership-driven visibility (chips everywhere, tile only in owner)

**Files:**
- Modify: `client/src/app/state/useMosaicVisibility.ts`
- Modify: `client/src/app/ui/MinimizedChip.tsx`
- Modify: `client/src/app/views/Mosaic.tsx`
- Modify: `client/src/app/ArgusApp.tsx`

**Interfaces:**
- Consumes: `useWindows` (Task 8).
- Produces: `useMosaicVisibility(myWindowId: string, isForeign: (id: string) => boolean)` — same returned API, but `isMinimized` returns `true` for any foreign-owned session, and the localStorage key is per-window. `MinimizedChip` gains optional `windowBadge?: string`. `Mosaic` gains props `isForeign: (id: string) => boolean`, `foreignLabel: (id: string) => string`, `onFocusForeign: (id: string) => void`.

- [ ] **Step 1: Scope useMosaicVisibility per window + ownership clause**

In `client/src/app/state/useMosaicVisibility.ts`:

- Signature: `export function useMosaicVisibility(myWindowId: string, isForeign: (id: string) => boolean): MosaicVisibilityApi`.
- Storage key becomes per-window, with a legacy fallback for main so existing users keep their minimize state:

```ts
function storageKey(myWindowId: string): string {
  return `mosaic-minimized:${myWindowId}`;
}

function loadMinimized(myWindowId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(myWindowId))
      // Legacy key (pre-multi-window) applies to the main window only.
      ?? (myWindowId === 'main' ? localStorage.getItem('mosaic-minimized') : null);
    if (!raw) return new Set();
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids.filter((id): id is string => typeof id === 'string')) : new Set();
  } catch {
    return new Set();
  }
}
```

- `useState(loadMinimized)` → `useState(() => loadMinimized(myWindowId))`; persist effect writes to `storageKey(myWindowId)`.
- `isMinimized` gains the ownership clause FIRST (a foreign session is always a chip, filters and force-show notwithstanding):

```ts
  const isMinimized = useCallback(
    (id: string, groupFilterIds: Set<string> | null | undefined, activeGroupId: string | null | undefined) => {
      if (isForeign(id)) return true;
      const currentGroup = activeGroupId ?? null;
      const forceShown = forced.group === currentGroup ? forced.ids : EMPTY_SET;
      return groupFilterIds ? (!groupFilterIds.has(id) && !forceShown.has(id)) : minimized.has(id);
    },
    [minimized, forced, isForeign],
  );
```

- [ ] **Step 2: MinimizedChip window badge**

In `client/src/app/ui/MinimizedChip.tsx`, add `windowBadge?: string` to props and render after the label:

```tsx
      {windowBadge && <span className="argus-chip-window-badge">{windowBadge}</span>}
```

Add the class to the stylesheet that defines `.argus-chip` (follow the existing chip token usage — small, muted, e.g. `font-size: 10px; opacity: 0.6; margin-left: 4px;`). Keep it background/inline only — hover must not change row size (project rule).

- [ ] **Step 3: Mosaic foreign-chip behavior**

In `client/src/app/views/Mosaic.tsx`:

- Add to `MosaicProps`: `isForeign: (id: string) => boolean; foreignLabel: (id: string) => string; onFocusForeign: (id: string) => void;` and destructure them.
- Where minimized chips render (the `minTiles` row and any chip usage), pass:
  - `windowBadge={isForeign(s.id) ? foreignLabel(s.id) : undefined}`
  - chip `onClick`: `isForeign(s.id) ? () => onFocusForeign(s.id) : <existing restore handler>`.
- Foreign chips must not join chip drag-reorder churn incorrectly — they already sit in the same row; reorder logic keys off ids and is unaffected. Leave drag as is.

- [ ] **Step 4: ArgusApp wiring**

In `client/src/app/ArgusApp.tsx`:

```ts
import { useWindows } from '../hooks/useWindows.js';
```

- After the socket is available: `const windowsApi = useWindows(socket);`
- `const mosaicVis = useMosaicVisibility();` → `const mosaicVis = useMosaicVisibility(windowsApi.myWindowId, windowsApi.isForeign);`
- Pass to `<Mosaic … isForeign={windowsApi.isForeign} foreignLabel={(id) => windowsApi.labelOf(windowsApi.ownerOf(id))} onFocusForeign={(id) => { void windowsApi.focusWindow(windowsApi.ownerOf(id)).catch(console.error); }} />`.
- Guard focus/open: wherever the app opens a session into focus view or expands it (`onOpenSession` handler passed to Mosaic/sidebar), first check `windowsApi.isForeign(id)` → if foreign, `void windowsApi.focusWindow(windowsApi.ownerOf(id)).catch(console.error)` and return.
- Dock badge: the spec's "only main sends `dock:setBadge`" guard needs no work — nothing in the renderer currently calls `electronApp.setBadge` (verified by grep). Skip it. This keeps sidebar clicks, palette jumps, and chip clicks consistent: foreign session → jump to its window.
- Focus view (`Focus.tsx` chips strip): sessions foreign to this window must not be focusable there either — the ownership clause in `isMinimized` plus the open-guard above covers it (Focus receives the open handler from ArgusApp).

- [ ] **Step 5: Typecheck + tests + manual check**

Run: `npm run build:all && npm test -w client && npm run lint -w client`
Expected: PASS.

Manual (dev, two windows): expand session in window A → appears as badged chip in window B; clicking the badged chip focuses window A.

- [ ] **Step 6: Commit**

```bash
# plus the stylesheet where .argus-chip-window-badge was added (find it with:
#   grep -rln "argus-chip" client/src --include="*.css")
git add client/src/app/state/useMosaicVisibility.ts client/src/app/ui/MinimizedChip.tsx client/src/app/views/Mosaic.tsx client/src/app/ArgusApp.tsx
git commit -m "feat(client): exclusive session ownership — foreign sessions render as badged chips"
```

---

### Task 10: Move gestures — context menu actions

**Files:**
- Modify: `client/src/app/ui/sessionMenu.ts`
- Modify: `client/src/app/ArgusApp.tsx`

**Interfaces:**
- Consumes: `useWindows` actions (Task 8).
- Produces: context-menu entries "Move to New Window", "Move to <label>" (one per other window), "Merge All Windows Here" — on every surface that uses `buildSessionMenuItems` (tiles, focus header, sidebar rows, chips).

- [ ] **Step 1: Extend SessionMenuActions + entries**

In `client/src/app/ui/sessionMenu.ts`, add to `SessionMenuActions`:

```ts
  /** Multi-window: absent handlers collapse the entries (mobile surface omits them). */
  onMoveToNewWindow?: (session: SessionInfo) => void;
  /** Other windows this session could move to (excludes the current window). */
  moveTargets?: { id: string; label: string }[];
  onMoveToWindow?: (session: SessionInfo, windowId: string) => void;
  onMergeAllHere?: () => void;
  /** True when >1 window exists — gates the merge entry. */
  canMergeAllHere?: boolean;
```

Import `AppWindow` and `Combine` from `lucide-react`. In `buildSessionMenuItems`, insert after the minimize entry (inside the Session block):

```ts
    ...(a.onMoveToNewWindow ? [{ id: 'move-new-window', label: 'Move to New Window', icon: AppWindow, onClick: () => a.onMoveToNewWindow!(session) }] : []),
    ...(a.onMoveToWindow
      ? (a.moveTargets ?? []).map((t) => ({
          id: `move-window-${t.id}`,
          label: `Move to ${t.label}`,
          icon: AppWindow,
          onClick: () => a.onMoveToWindow!(session, t.id),
        }))
      : []),
    ...(a.onMergeAllHere && a.canMergeAllHere ? [{ id: 'merge-all-windows', label: 'Merge All Windows Here', icon: Combine, onClick: () => a.onMergeAllHere!() }] : []),
```

- [ ] **Step 2: Wire in ArgusApp**

In the `sessionMenuActions` object (`ArgusApp.tsx:577`), add:

```ts
    onMoveToNewWindow: (s: SessionInfo) => { void windowsApi.moveToNewWindow(s.id).catch(console.error); },
    moveTargets: windowsApi.windows
      .filter((w) => w.id !== windowsApi.myWindowId)
      .map((w) => ({ id: w.id, label: w.label })),
    onMoveToWindow: (s: SessionInfo, windowId: string) => { void windowsApi.moveToWindow(s.id, windowId).catch(console.error); },
    onMergeAllHere: () => { void windowsApi.mergeAllHere().catch(console.error); },
    canMergeAllHere: windowsApi.windows.length > 1,
```

(If `sessionMenuActions` is memoized, add `windowsApi` fields to its dependency array.)

- [ ] **Step 3: Typecheck + lint + manual check**

Run: `npm run build:all && npm run lint -w client`
Expected: PASS.

Manual (dev): right-click a tile → "Move to New Window" spawns a window owning that session (tile disappears here, chip appears with badge); with 2+ windows, "Move to Window 2" and "Merge All Windows Here" behave per spec; merging deletes the emptied secondary window (its BrowserWindow closes).

- [ ] **Step 4: Commit**

```bash
git add client/src/app/ui/sessionMenu.ts client/src/app/ArgusApp.tsx
git commit -m "feat(client): move-to-window and merge-all context-menu actions"
```

---

### Task 11: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (architecture blurb)

- [ ] **Step 1: Full gate**

Run: `npm run lint -w client && npm run build:all && npm test`
Expected: all PASS.

- [ ] **Step 2: Manual smoke checklist (dev `npm run dev`, then packaged if releasing)**

- [ ] Cmd+Shift+N opens an empty second window; all sessions appear there as badged chips.
- [ ] Context-menu "Move to New Window" moves a session; the source window shows a badged chip.
- [ ] Clicking a badged chip focuses the owning window.
- [ ] Red-button close on the secondary window: window closes, its sessions reappear in main as chips.
- [ ] "Merge All Windows Here" from main: secondary windows close, everything in main.
- [ ] Quit + relaunch with 2 windows open: both windows restore at their positions with their sessions.
- [ ] Per-window zoom: Cmd+= in window 2 does not zoom main; both levels survive relaunch.
- [ ] Notification click on a session owned by window 2 focuses window 2.
- [ ] Typing/resizing a session in its owning window works normally (no resize storms — only one window mounts the terminal).
- [ ] `dev:web` (browser) still works as a plain main window.

- [ ] **Step 3: Update CLAUDE.md**

In the server section, add `WindowRegistry`/`WindowStore` to the services/persistence lists; in Key Details add one line: multi-window — each Electron window loads `?windowId=<id>`; session→window ownership lives server-side in `windows.json`; sessions render expanded only in their owning window.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: multi-window architecture notes"
```

---

### Task 12 (Phase 2): Drag tear-off

**Files:**
- Modify: `client/src/app/views/Mosaic.tsx`

**Interfaces:**
- Consumes: `moveToNewWindow` via a new Mosaic prop `onTearOff: (sessionId: string) => void` wired from ArgusApp to `windowsApi.moveToNewWindow`.
- Produces: dragging a tile so the pointer ends outside the window bounds spawns a new window owning that session.

- [ ] **Step 1: Detect drag-out in handleTileDragEnd**

@dnd-kit has no cross-window drag; this is drag-out *detection*. In `Mosaic.tsx`, extend `handleTileDragEnd`:

```ts
  const handleTileDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    // Tear-off: pointer released outside the window → move to a new window.
    const activator = event.activatorEvent as PointerEvent | undefined;
    if (activator && typeof activator.clientX === 'number') {
      const x = activator.clientX + event.delta.x;
      const y = activator.clientY + event.delta.y;
      const out = x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight;
      if (out && !over) {
        onTearOff(active.id as string);
        setActiveTileId(null);
        return;
      }
    }
    // …existing reorder logic unchanged…
  };
```

Gate on `!over` so an in-grid drop near the edge still reorders. Add `onTearOff: (sessionId: string) => void` to `MosaicProps`; wire from ArgusApp: `onTearOff={(id) => { void windowsApi.moveToNewWindow(id).catch(console.error); }}`.

- [ ] **Step 2: Typecheck + manual check**

Run: `npm run build:all && npm run lint -w client`
Expected: PASS.

Manual: drag a tile past the window edge and release → new window opens owning it; edge-adjacent in-grid drops still reorder.

- [ ] **Step 3: Commit**

```bash
git add client/src/app/views/Mosaic.tsx client/src/app/ArgusApp.tsx
git commit -m "feat(client): drag tear-off — drag a tile out of the window to spawn a new one"
```
