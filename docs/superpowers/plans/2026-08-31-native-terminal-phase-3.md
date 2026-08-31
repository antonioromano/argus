# Native Terminal Engine — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the native terminal engine from a dev-flag experiment into a real product surface — chosen per session in the UI, persisted, with search and clear working, no shortcuts lost, and shipped inside the packaged app.

**Architecture:** `terminalEngine` becomes a persisted per-session field with an app-wide default, replacing the build-flag decision. The renderer asks per session rather than globally. The five renderer-only shortcuts become app-menu accelerators so they survive a native tile holding key focus, and the two terminal-scoped ones (`mod+f`, `mod+l`) gain native implementations. Finally the Swift dylib and N-API addon get wired into packaging for both arches.

**Tech Stack:** SwiftTerm (SwiftPM), Swift 6.2, N-API via node-addon-api 8.9.2, Electron 42, electron-builder, TypeScript ESM, `node:test`, Vitest, XCTest.

**Spec:** `docs/superpowers/specs/2026-08-28-native-terminal-engine-design.md`

## Global Constraints

- macOS only. Every native path degrades to `web` on failure — never throw into a render path.
- The native view **never owns a pty**. Input and resize go back only through `SessionManager.writeToSession` / `resizeSession`.
- **`web` remains the default and the universal fallback.** `terminalEngine` is a *preference*, never a guarantee: `/mobile`, any non-Electron client, non-macOS, and addon-load failure all silently use xterm.js.
- TypeScript strict, ES2022, ESM. Server and electron imports use `.js` extensions.
- Node 24 (`.nvmrc`). Prefix PATH with `$HOME/.nvm/versions/node/v24.16.0/bin` for every node/npm/npx command — Node 18 is the shell default and breaks the Vite build.
- Suites that must stay green: `npm run lint -w client`, `npm test` (server 393+, client 296+), `swift test` in `native/ArgusTerminal` (7+), `npm run build:all`.
- Branch: `feat/native-terminal-engine`, continuing from Phase 2 (HEAD `362e0c5`).
- **Safety:** the user's real Argus (`/Applications/Argus.app`, port 5757) and its argusd daemon host live work. Never `pkill`/`killall`, never `tmux kill-server`. Only stop processes you started, by exact PID. Dev mode hardcodes `ARGUS_PORT=5403` (`main.ts:562-583`) — an override is ignored; use the app's built-in dev isolation. `SIGTERM` does not trigger `before-quit` on macOS.

## Two rulings that shape this plan

**Menu accelerators stay static, matching existing behaviour.** The four existing menu items hardcode accelerators (`CmdOrCtrl+K` at `main.ts:414`) while the registry holds the rebindable defaults (`mod+k` in `client/src/keyboard/registry.ts`). Rebinding in Settings already does not update the menu. Making menus config-driven is a real improvement but affects four bindings unrelated to this feature — out of scope here. Task 5 records the limitation in a comment rather than growing.

**Native search reuses Argus's own search UI**, not SwiftTerm's built-in `MacFindBarView`. `TerminalShell` already threads `searchOpen` / `onOpenSearch` / `onCloseSearch`, which the native hole ignores. Adopting SwiftTerm's find bar would be less work but would give the app two visually different search boxes depending on engine.

---

## File Structure

| Path | Responsibility |
|---|---|
| `shared/src/types.ts` (modify) | `TerminalEngine` type; `SessionInfo.terminalEngine`; `CreateSessionRequest.terminalEngine`; `AppConfig.defaultTerminalEngine` |
| `server/src/services/SessionManager.ts` (modify) | accept, default, persist and restore `terminalEngine` |
| `server/src/services/SessionManager.engine.test.ts` (create) | tests for the above |
| `server/src/routes/sessions.ts` (modify) | pass `terminalEngine` through the create route |
| `server/src/persistence/ConfigStore.ts` (modify) | default for `defaultTerminalEngine` |
| `client/src/app/overlays/CreateSheet.tsx` (modify) | engine picker |
| `client/src/app/overlays/CloneSheet.tsx` (modify) | engine picker |
| `client/src/app/overlays/settings/*` (modify) | default-engine setting |
| `client/src/hooks/useNativeEngine.ts` (modify) | per-session decision, not global |
| `client/src/hooks/useNativeEngine.test.tsx` (create) | tests for the decision + fallbacks |
| `client/src/app/views/{Focus,Mosaic}.tsx` (modify) | pass the session's engine |
| `electron/src/main.ts` (modify) | five new menu items + channels; search/clear IPC |
| `electron/src/preload.ts` (modify) | new menu channels; search/clear bridge |
| `client/src/app/ArgusApp.tsx` (modify) | handle the five new menu events |
| `native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift` (modify) | `search` / `clearSearch` |
| `native/addon/src/addon.mm` (modify) | expose `search` / `clearSearch` |
| `electron/src/nativeTerminal/{types,NativeTerminalHost}.ts` (modify) | search/clear pass-through |
| `electron-builder.config.cjs` (modify) | `asarUnpack` + `extraResources` for the addon and dylib |
| `package.json` (modify) | `build:native` into `build:all` and `package:mac` |

---

## Task 1: `terminalEngine` end to end

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `server/src/services/SessionManager.ts`
- Modify: `server/src/routes/sessions.ts`
- Create: `server/src/services/SessionManager.engine.test.ts`

**Interfaces:**
- Produces: `type TerminalEngine = 'web' | 'native'`; `SessionInfo.terminalEngine?: TerminalEngine`; `CreateSessionRequest.terminalEngine?: TerminalEngine`; `AppConfig.defaultTerminalEngine?: TerminalEngine`. `createSession(..., terminalEngine?)` persists it and restores it. Later tasks read `session.terminalEngine`.

- [ ] **Step 1: Write the failing test**

```ts
// server/src/services/SessionManager.engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

const cfg = (defaultTerminalEngine?: 'web' | 'native') => ({
  load: async () => ({
    defaultAgent: 'claude', customAgents: [], agentFlags: {},
    ...(defaultTerminalEngine ? { defaultTerminalEngine } : {}),
  }),
  save: async () => {},
}) as any;

/** toSessionInfo is what reaches the client and what gets persisted. */
function infoFor(sm: SessionManager, session: any) {
  (sm as any).sessions.set(session.id, session);
  return (sm as any).toSessionInfo(session);
}

test('terminalEngine round-trips through toSessionInfo', () => {
  const sm = new SessionManager(os.tmpdir(), cfg());
  const info = infoFor(sm, {
    id: 's1', name: 'n', folderPath: '/tmp', status: 'idle',
    createdAt: new Date().toISOString(), agentType: 'claude', flags: [],
    terminalEngine: 'native',
  });
  assert.equal(info.terminalEngine, 'native');
});

test('a session with no engine reports undefined, not a fabricated default', () => {
  // The RENDERER resolves the default. Baking one in here would make an
  // explicit 'web' choice indistinguishable from "never chose", which matters
  // if the app default later changes.
  const sm = new SessionManager(os.tmpdir(), cfg('native'));
  const info = infoFor(sm, {
    id: 's2', name: 'n', folderPath: '/tmp', status: 'idle',
    createdAt: new Date().toISOString(), agentType: 'claude', flags: [],
  });
  assert.equal(info.terminalEngine, undefined);
});

test('an invalid engine value is rejected at the boundary', () => {
  const sm = new SessionManager(os.tmpdir(), cfg());
  assert.equal((sm as any).normalizeTerminalEngine('native'), 'native');
  assert.equal((sm as any).normalizeTerminalEngine('web'), 'web');
  assert.equal((sm as any).normalizeTerminalEngine('gpu'), undefined);
  assert.equal((sm as any).normalizeTerminalEngine(undefined), undefined);
  assert.equal((sm as any).normalizeTerminalEngine(''), undefined);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx tsx --test server/src/services/SessionManager.engine.test.ts
```
Expected: FAIL — `terminalEngine` is not carried, `normalizeTerminalEngine` undefined.

- [ ] **Step 3: Add the shared types**

In `shared/src/types.ts`, beside `BuiltinAgentId`:

```ts
/** Which terminal implementation renders a session. `web` (xterm.js) is the
 *  default and the universal fallback; `native` is a macOS-only preference that
 *  silently degrades to `web` on mobile, off-Electron, off-macOS, or if the
 *  native addon fails to load. */
export type TerminalEngine = 'web' | 'native';
```

Add `terminalEngine?: TerminalEngine;` to `SessionInfo` and to `CreateSessionRequest`, and `defaultTerminalEngine?: TerminalEngine;` to `AppConfig`.

- [ ] **Step 4: Carry it through SessionManager**

Add the validator as a private method — an unvalidated string from the REST body must not reach persisted state:

```ts
  /** Accept only the two known values. Anything else becomes undefined so the
   *  renderer falls back to the app default rather than persisting garbage. */
  private normalizeTerminalEngine(value: unknown): TerminalEngine | undefined {
    return value === 'web' || value === 'native' ? value : undefined;
  }
```

Add a `terminalEngine?: TerminalEngine` parameter to `createSession` (append it after `attachExisting` so existing positional callers are unaffected), store `this.normalizeTerminalEngine(terminalEngine)` on the `ManagedSession`, add `terminalEngine: session.terminalEngine` to `toSessionInfo` (`SessionManager.ts:1530-1542`), and include it in the persisted record and the restore path so it survives a restart.

- [ ] **Step 5: Pass it through the REST route**

In `server/src/routes/sessions.ts:114`, destructure `terminalEngine` from the body and forward it to `createSession`.

- [ ] **Step 6: Run tests**

```bash
npx tsx --test server/src/services/SessionManager.engine.test.ts
npm test -w server
npm run build:all
```
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/src server/src
git commit -m "feat: persist a per-session terminalEngine preference"
```

---

## Task 2: Engine pickers in Create and Clone

**Files:**
- Modify: `client/src/app/overlays/CreateSheet.tsx`
- Modify: `client/src/app/overlays/CloneSheet.tsx`
- Modify: `client/src/services/api.ts` (if the create call needs the new field)

**Interfaces:**
- Consumes: `TerminalEngine` from Task 1.
- Produces: both sheets pass `terminalEngine` into their create/clone callbacks.

- [ ] **Step 1: Read how the agent picker is built**

`CreateSheet.tsx:711-738` renders the agent list as buttons. Match that visual language exactly — this is a second small picker in the same sheet, not a new design. Read `CloneSheet.tsx`'s equivalent block too.

- [ ] **Step 2: Add the picker to CreateSheet**

Two options, `Web` and `Native (macOS)`, defaulting to `config?.defaultTerminalEngine ?? 'web'`. Show the native option only when it could work — gate on the same availability check the renderer uses, so a user on a build without the addon is not offered a choice that silently downgrades:

```tsx
const [terminalEngine, setTerminalEngine] = useState<TerminalEngine>(
  config?.defaultTerminalEngine ?? 'web',
);
```

Include `terminalEngine` in the `onCreate` call. Label the native option honestly — it is macOS-only and falls back on a phone.

- [ ] **Step 3: Add the same picker to CloneSheet**

A clone should inherit the source session's engine as its initial value rather than the app default — cloning a native session and silently getting a web one would be surprising. Use `currentTerminalEngine ?? config?.defaultTerminalEngine ?? 'web'`.

- [ ] **Step 4: Thread it through the create path**

Update `onCreate` / `onClone` signatures and the `api` client so `terminalEngine` reaches `POST /api/sessions`.

- [ ] **Step 5: Verify**

```bash
npm run lint -w client && npm test -w client && npm run build:all
```
Expected: green, no regressions in the existing sheet tests.

- [ ] **Step 6: Commit**

```bash
git add client/src
git commit -m "feat(client): choose the terminal engine when creating or cloning a session"
```

---

## Task 3: Default engine in Settings

**Files:**
- Modify: `client/src/app/overlays/SettingsOverlay.tsx` (or the appropriate `settings/` panel — read first and follow the file's existing structure)
- Modify: `server/src/persistence/ConfigStore.ts`

**Interfaces:**
- Consumes: `AppConfig.defaultTerminalEngine` from Task 1.

- [ ] **Step 1: Give the config a default**

In `ConfigStore.ts`, default `defaultTerminalEngine` to `'web'` alongside the other defaults. `web` is the safe default and the spec's stated one.

- [ ] **Step 2: Add the setting**

The settings live in `client/src/app/overlays/SettingsOverlay.tsx` (there is only one
panel file besides `settings/KeyboardSettings.tsx`). `mosaicWaitingStyle` at
`SettingsOverlay.tsx:477-495` is the exact analogous control — a two-option
segmented row of `<button>`s with `all: 'unset'` and accent tokens for the
selected state. Copy that block's shape verbatim rather than inventing a
control:

```tsx
{(['web', 'native'] as const).map((val) => {
  const label = val === 'web' ? 'Web (xterm.js)' : 'Native (macOS)';
  const cur = config.defaultTerminalEngine ?? 'web';
  return (
    <button
      key={val}
      onClick={() => onSave({ defaultTerminalEngine: val })}
      style={{
        all: 'unset',
        cursor: 'pointer',
        padding: '6px var(--s-3)',
        background: cur === val ? 'var(--accent-bg)' : 'var(--bg-1)',
        border: `1px solid ${cur === val ? 'var(--accent-edge)' : 'var(--line-2)'}`,
        borderRadius: 'var(--r-2)',
        fontSize: 'var(--t-sm)',
        color: cur === val ? 'var(--accent)' : 'var(--fg-1)',
        textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      {label}
    </button>
  );
})}
```

Place it in the same section as the other terminal-related settings, with
helper copy stating that it applies to newly created sessions, and that
non-macOS and remote clients always use the web engine.

- [ ] **Step 3: Verify**

```bash
npm run lint -w client && npm test -w client && npm test -w server && npm run build:all
```

- [ ] **Step 4: Commit**

```bash
git add client/src server/src
git commit -m "feat: app-wide default terminal engine setting"
```

---

## Task 4: The renderer honours the per-session engine

This replaces the global build-flag decision with a per-session one. It is the task that actually makes the picker do something.

**Files:**
- Modify: `client/src/hooks/useNativeEngine.ts`
- Create: `client/src/hooks/useNativeEngine.test.tsx`
- Modify: `client/src/app/views/Focus.tsx`, `client/src/app/views/Mosaic.tsx`

**Interfaces:**
- Produces: `useNativeTerminalAvailable(): boolean` — the app-wide availability check (addon loaded), resolved once; and a pure helper `resolveTerminalEngine(sessionEngine, appDefault, available): boolean` returning whether THIS session renders native. Later reads go through the helper so the rules live in one testable place.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/hooks/useNativeEngine.test.tsx
import { describe, it, expect } from 'vitest';
import { resolveTerminalEngine } from './useNativeEngine.js';

describe('resolveTerminalEngine', () => {
  it('uses native only when the session asks for it and it is available', () => {
    expect(resolveTerminalEngine('native', 'web', true)).toBe(true);
  });

  it('falls back to web when the addon is unavailable, whatever the session asked for', () => {
    // The universal fallback: a preference is never a guarantee.
    expect(resolveTerminalEngine('native', 'native', false)).toBe(false);
  });

  it('an explicit web session stays web even when the default is native', () => {
    expect(resolveTerminalEngine('web', 'native', true)).toBe(false);
  });

  it('a session with no stored preference follows the app default', () => {
    expect(resolveTerminalEngine(undefined, 'native', true)).toBe(true);
    expect(resolveTerminalEngine(undefined, 'web', true)).toBe(false);
  });

  it('an unknown stored value is treated as no preference, not as native', () => {
    // Defensive: persisted state can predate a schema change.
    expect(resolveTerminalEngine('gpu' as never, 'web', true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/hooks/useNativeEngine.test.tsx --root client
```
Expected: FAIL — `resolveTerminalEngine` is not exported.

- [ ] **Step 3: Implement**

```ts
/** Whether THIS session renders with the native engine. The rules live here,
 *  in one pure function, because they are the product's fallback contract:
 *  a session preference wins over the app default, and availability vetoes
 *  both. Anything unrecognised counts as "no preference". */
export function resolveTerminalEngine(
  sessionEngine: TerminalEngine | undefined,
  appDefault: TerminalEngine | undefined,
  available: boolean,
): boolean {
  if (!available) return false;
  const choice = sessionEngine === 'web' || sessionEngine === 'native'
    ? sessionEngine
    : (appDefault === 'native' ? 'native' : 'web');
  return choice === 'native';
}
```

Rename the existing hook to `useNativeTerminalAvailable()` — it keeps its current body (build flag + `available()` probe + cancellation + `.catch`), it just no longer decides per session.

- [ ] **Step 4: Use it in both views**

`Focus.tsx`: `const useNative = resolveTerminalEngine(session.terminalEngine, config?.defaultTerminalEngine, available);`

`Mosaic.tsx`: resolve `available` and `config` ONCE at the Mosaic root (as Phase 2 established, to avoid tiles disagreeing mid-probe) and compute per tile. The per-tile value must remain a **stable boolean** — `TerminalShell` is `memo(TerminalShellRouter)` and this repo treats that memoization as load-bearing.

**Keep the build flag as a master switch for now**: `VITE_ARGUS_NATIVE_TERM` unset must still mean nobody gets native, regardless of stored preferences. Removing that gate is a deliberate release decision, not this task's call. State in your report how you preserved it.

- [ ] **Step 5: Verify**

```bash
npx vitest run src/hooks --root client
npm run lint -w client && npm test -w client && npm run build:all
```

- [ ] **Step 6: Commit**

```bash
git add client/src
git commit -m "feat(client): honour the per-session terminal engine"
```

---

## Task 5: Menu-accelerator migration for the five renderer-only shortcuts

A native tile holds key focus, so the renderer never sees its `keydown`. Four bindings already survive because they are app-menu accelerators; these five do not.

**Files:**
- Modify: `electron/src/main.ts` (menu construction, ~`main.ts:412-431`)
- Modify: `electron/src/preload.ts` (`MENU_CHANNELS`, `preload.ts:31-37`)
- Modify: `client/src/app/ArgusApp.tsx` (menu-event handling, ~`:294`)

**Interfaces:**
- Produces: five new menu channels — `menu:open-diff`, `menu:open-files`, `menu:open-shell`, `menu:terminal-search`, `menu:clear-terminal` — each dispatching the same action the keyboard path already dispatches.

- [ ] **Step 1: Read how an existing menu event flows end to end**

Trace `menu:open-settings`: `main.ts:350` (menu item + accelerator) → `sendMenuEvent` → `preload.ts:31` (`MENU_CHANNELS`) → `ArgusApp.tsx:294` (`window.electronApp` subscription). Your five follow the identical path. Write down the exact subscription shape before editing.

- [ ] **Step 2: Add the channels**

Extend `MENU_CHANNELS` with the five names above. The list is the security boundary for what main may push to the renderer — keep it explicit.

- [ ] **Step 3: Add the menu items**

Add them to the View menu (or the most fitting existing submenu — read the current structure and choose), with the registry's default accelerators: `CmdOrCtrl+D`, `CmdOrCtrl+E`, `CmdOrCtrl+T`, `CmdOrCtrl+F`, `CmdOrCtrl+L`. Add this comment above them:

```ts
      // These five were renderer-only keydown handlers. A native terminal
      // overlay is a child NSWindow that takes key focus, so the renderer never
      // sees their keydown — as app-menu accelerators they fire regardless of
      // which view has focus.
      //
      // KNOWN LIMITATION, pre-existing: accelerators here are static, while
      // client/src/keyboard/registry.ts holds the user-rebindable defaults. A
      // user who rebinds one in Settings will not see the menu update. The four
      // existing menu items (mod+n, mod+w, mod+k, mod+,) already behave this
      // way; making menus config-driven is a separate change.
```

- [ ] **Step 4: Handle them in the renderer**

In `ArgusApp.tsx`, route each new menu event to the SAME action its keyboard case already performs. Do not duplicate the action bodies — extract or reuse, so the two entry points cannot drift.

- [ ] **Step 5: Verify no double-fire**

The keyboard path still exists for web tiles. Confirm that pressing the shortcut in a WEB tile does not now trigger the action twice (once via keydown, once via the accelerator). If Electron delivers both, suppress the renderer keydown path for these five when the menu accelerator owns them — and say in your report which behaviour you observed and how you checked. This is the most likely defect in this task.

- [ ] **Step 6: Verify**

```bash
npm run lint -w client && npm test -w client && npm run build:all
```

- [ ] **Step 7: Commit**

```bash
git add electron/src client/src
git commit -m "feat: promote the five terminal shortcuts to app-menu accelerators"
```

---

## Task 6: Search and clear for native tiles

**Files:**
- Modify: `native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift` (+ `ShimTests.swift`)
- Modify: `native/addon/src/addon.mm`
- Modify: `electron/src/nativeTerminal/types.ts`, `NativeTerminalHost.ts` (+ `.test.ts`)
- Modify: `electron/src/main.ts`, `electron/src/preload.ts`
- Modify: `client/src/app/ui/TerminalShell.tsx`

**Interfaces:**
- Produces: Swift `@objc func search(_ term: String, forward: Bool) -> Bool` and `@objc func clearSearch()` (selectors `search:forward:`, `clearSearch`); addon exports `search(id, term, forward): boolean` and `clearSearch(id): void`; host methods of the same shape; IPC + preload bridge; the native hole wires Argus's existing search props.

- [ ] **Step 1: Write the failing Swift test**

```swift
  func testSearchFindsFedText() {
    let c = OverlayController(width: 400, height: 200)
    c.feed(data: Data("alpha beta gamma\r\n".utf8) as NSData)
    XCTAssertTrue(c.search("beta", forward: true))
    XCTAssertFalse(c.search("nonexistent-token", forward: true))
  }

  func testClearScrollbackKeepsVisibleScreenAfterSearch() {
    let c = OverlayController(width: 400, height: 200)
    c.feed(data: Data("findme\r\n".utf8) as NSData)
    _ = c.search("findme", forward: true)
    c.clearSearch()
    c.clearScrollback()
    XCTAssertEqual(c.debugRow(0), "findme")
  }
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd native/ArgusTerminal && swift test
```
Expected: FAIL — no `search` member.

- [ ] **Step 3: Implement in Swift**

SwiftTerm ships the machinery: `TerminalViewSearch.swift` exposes `searchMatchSummary(_:options:limit:)` and `clearSearch()`, over a `SearchEngine` with `findNextWithSelection` / `findPreviousWithSelection`. Read that file and drive it — do NOT reimplement searching. Return whether a match was found so the renderer can show a no-results state. Keep the members `@objc` with bridgeable types (`String`, `Bool`) — Swift arrays and `[UInt8]` closures do not bridge.

- [ ] **Step 4: Expose in the addon**

Follow `addon.mm`'s validating convention (`Create`/`SetFrame`/`Reparent` all validate and throw a JS `TypeError`; `.As<T>()` performs no runtime check and continuing after a pending exception is UB). Validate that the term is a string before use.

- [ ] **Step 5: Rebuild and smoke**

```bash
cd native/ArgusTerminal && swift build -c release && cd ../..
npx node-gyp rebuild --directory=native/addon \
  --target=$(node -p "require('electron/package.json').version") \
  --dist-url=https://electronjs.org/headers
ELECTRON_RUN_AS_NODE=1 npx electron -e "const a=require('./native/addon/build/Release/argus_native_terminal.node'); console.log(Object.keys(a).length);"
```
Expected: 12 exports.

- [ ] **Step 6: Host pass-through with tests**

Add `search(sessionId, term, forward): boolean` and `clearSearch(sessionId): void` to `NativeTerminalHost`, guarded like every other native call (a throw must not propagate) and returning false for an unknown session. Add host tests using the existing `fakeAddon()` + `harness()` pattern, including: search on an unattached session returns false and does not throw.

- [ ] **Step 7: Wire the renderer**

`TerminalShellNativeHole` currently ignores `searchOpen` / `onOpenSearch` / `onCloseSearch`. Wire them so Argus's existing search UI drives the native engine, and `mod+l` calls `clearScrollback`. Reuse the existing search component — the point of this ruling is one search UI for both engines.

- [ ] **Step 8: Verify**

```bash
cd native/ArgusTerminal && swift test && cd ../..
npx tsx --test electron/src/nativeTerminal/NativeTerminalHost.test.ts
npm run lint -w client && npm test && npm run build:all
```

- [ ] **Step 9: Commit**

```bash
git add native electron/src client/src
git commit -m "feat: search and clear scrollback in native terminals"
```

---

## Task 7: Packaging for both architectures

Nothing native currently ships. `build:native` exists but is in neither `build:all` nor `package:mac`, and `electron-builder.config.cjs` is untouched — the packaged app contains no addon at all, which is why the dev-tree rpath has not yet mattered.

**Files:**
- Modify: `package.json` (scripts)
- Modify: `electron-builder.config.cjs`
- Modify: `native/addon/binding.gyp` and/or the Swift build invocation (arch handling)

**Interfaces:**
- Produces: a packaged `.dmg` for `arm64` and `x64` that contains a loadable addon.

- [ ] **Step 1: Establish the arch problem before changing anything**

`electron-builder.config.cjs:78` ships `target: [{ target: 'dmg', arch: ['arm64', 'x64'] }]`. Today `swift build -c release` and `node-gyp rebuild` both produce host-arch binaries only. Determine and write down in your report: does electron-builder run the build once per arch, or once total? That answer decides whether you need per-arch outputs (like `argusd-${process.arch}`, the pattern this repo already uses for its Go daemon at `electron/resources/argusd/`) or a universal binary.

**Follow the `argusd` precedent** unless you find a concrete reason not to — it already solves this exact problem in this exact repo, and `afterPack.cjs` already handles its signing.

- [ ] **Step 2: Wire the build**

Add `build:native` to `build:all` and to `package:mac` in the right order — the Swift dylib must exist before node-gyp, and both must exist before electron-builder runs.

- [ ] **Step 3: Make the artifacts ship**

Add `asarUnpack` for the `.node` (a native module cannot load from inside an asar) and `extraResources` for the dylib, following the existing entries' shape.

- [ ] **Step 4: Fix the rpath for the packaged layout**

The dev rpath is `@loader_path/../../../ArgusTerminal/.build/release`, which does not exist in a packaged app. Point it at wherever Step 3 places the dylib. Verify with `otool -l` on the packaged binary, not by reasoning.

- [ ] **Step 5: Confirm signing still works**

`afterPack.cjs` ad-hoc re-signs Mach-O binaries deep in the unsigned fallback path. The new `.node` and dylib are Mach-O. Confirm they are signed and that the pass does not break the `terminal-notifier` stash it already manages. Read `afterPack.cjs` before assuming.

- [ ] **Step 6: Build and verify a real package**

```bash
npm run package:mac
```
Then, on the produced app bundle: confirm the addon file is present and unpacked, `otool -L` resolves the dylib, and the app boots with `ARGUS_NATIVE_TERM=1` and loads the addon.

**Do not install or launch the packaged app over the user's running `/Applications/Argus.app`.** Inspect the build output in place.

- [ ] **Step 7: Commit**

```bash
git add package.json electron-builder.config.cjs native
git commit -m "build: ship the native terminal addon in the packaged app"
```

---

## Definition of done

- All suites green: lint, server, client, `swift test`, `build:all`.
- A session created with the native engine renders natively and persists that choice across an app restart; a web session is unaffected.
- All five migrated shortcuts work while a native tile holds focus, and do not double-fire in a web tile.
- Search and clear work in a native tile using Argus's own search UI.
- `npm run package:mac` produces a dmg whose app loads the addon.
- With `VITE_ARGUS_NATIVE_TERM` unset, the app is byte-for-byte unchanged regardless of stored preferences.
