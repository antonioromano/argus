# Native Terminal Engine — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the native terminal usable across the whole desktop surface — every Mosaic tile, multiple simultaneous overlays, correct z-order against modals, and correct behaviour across windows — without regressing the xterm.js default path.

**Architecture:** Phase 1 proved one overlay in Focus mode. Phase 2 makes overlays plural and safe. Three safety gaps close first (alt-screen seeding, reparenting, explicit detach), then per-session fallback so one failed overlay degrades to xterm.js instead of showing a blank hole, then intersection-based suppression so DOM surfaces are never hidden behind a child window, and only then Mosaic. `NativeTerminalHost` stays the single owner of overlay lifecycle; window knowledge stays in `main.ts`; the renderer owns geometry truth.

**Tech Stack:** SwiftTerm (SwiftPM), Swift 6.2, N-API via node-addon-api 8.9.2, Electron 42, TypeScript ESM, `node:test`, Vitest, XCTest.

**Spec:** `docs/superpowers/specs/2026-08-28-native-terminal-engine-design.md`

## Global Constraints

- macOS only. Every native path degrades to `web` on failure — never throw into a render path.
- The native view **never owns a pty**. Input and resize go back only through `SessionManager.writeToSession` / `resizeSession`.
- **Dark by default.** With `ARGUS_NATIVE_TERM` / `VITE_ARGUS_NATIVE_TERM` unset, behaviour must be byte-for-byte the current app. This is the property that makes the branch safe to merge.
- TypeScript strict, ES2022, ESM. Server and electron imports use `.js` extensions.
- Node 24 (`.nvmrc`). Prefix PATH with `$HOME/.nvm/versions/node/v24.16.0/bin` for every node/npm/npx command — Node 18 is the shell default and breaks the Vite build.
- Suites that must stay green: `npm run lint -w client`, `npm test` (server 393+, client 279+), `swift test` in `native/ArgusTerminal` (5+), `npm run build:all`.
- Branch: `feat/native-terminal-engine`, continuing from Phase 1 (HEAD `2c4b0ac`).
- **Safety:** the user's real Argus (`/Applications/Argus.app`, port 5757) and its argusd daemon host live work. Never `pkill`/`killall`, never `tmux kill-server`. Only stop processes you started, by exact PID. Dev mode hardcodes `ARGUS_PORT=5403` (`main.ts:562-583`) — an `ARGUS_PORT` override is ignored; use the app's built-in dev isolation instead.

## Explicit non-goal: overlay pre-warming

The spec lists pre-warming to hide the ~100 ms burst when a 12-tile mosaic opens. **Deliberately not built.** Measured cost is ~12 ms per window creation, one-off, off the renderer's critical path (the Phase 1 spike measured 120 fps sustained with 12 overlays tracking). Pre-warm machinery means a pool, eviction, and a new class of "overlay exists but belongs to nobody" bugs, to buy a one-time 100 ms. Revisit only if the burst is actually felt with real tiles.

---

## File Structure

| Path | Responsibility |
|---|---|
| `server/src/services/SessionManager.ts` (modify) | widen the replay snapshot consumed by the host |
| `native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift` (modify) | add `reparent(to:)`, guard double `attach` |
| `native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift` (modify) | cover reparent + double-attach |
| `native/addon/src/addon.mm` (modify) | expose `reparent` |
| `electron/src/nativeTerminal/types.ts` (modify) | `reparent` on the addon interface; `attach` returns boolean; widened snapshot |
| `electron/src/nativeTerminal/NativeTerminalHost.ts` (modify) | reparent path, attach result, alt-screen seed |
| `electron/src/nativeTerminal/NativeTerminalHost.test.ts` (modify) | cover the above |
| `electron/src/main.ts` (modify) | `attach` becomes `invoke`; detach on session exit; suppression IPC |
| `electron/src/preload.ts` (modify) | `attach` returns a promise; add `suppress`/`unsuppress` |
| `client/src/hooks/nativeOverlayRegistry.ts` (create) | renderer-side registry of live overlay rects + suppression refcounts; **exports the client's single `Rect` type** — `useNativeOverlayRect` must import it rather than keep its local copy |
| `client/src/hooks/nativeOverlayRegistry.test.ts` (create) | unit tests for the registry |
| `client/src/hooks/useNativeOverlayRect.ts` (modify) | register/unregister; report attach failure |
| `client/src/hooks/useOverlaySuppression.ts` (create) | the hook floating surfaces call |
| `client/src/hooks/useOverlaySuppression.test.tsx` (create) | hook tests |
| `client/src/hooks/overlaySuppressionContract.test.ts` (create) | contract test over the z-tier components |
| `client/src/app/ui/TerminalShell.tsx` (modify) | fall back to xterm on attach failure |
| `client/src/app/views/Mosaic.tsx` (modify) | pass `useNative` per tile |
| `client/src/hooks/useNativeEngine.ts` (create) | shared "is native wanted and available" decision, used by Focus + Mosaic |
| `client/src/components/primitives/{Sheet,AlertSheet,ContextMenu,Tooltip,Toast}.tsx`, `client/src/app/overlays/{Overlay,MergePreviewSheet}.tsx` (modify) | call the suppression hook |

---

## Task 1: Seed alt-screen state on attach

A native overlay attached to a session already inside vim/htop opens garbled, because `getReplaySnapshot` is narrowed to `{ data }` and the alternate-screen / mouse-mode flags never reach the view. Phase 2 makes attach common, so this stops being theoretical.

**Files:**
- Modify: `electron/src/nativeTerminal/types.ts`
- Modify: `electron/src/nativeTerminal/NativeTerminalHost.ts`
- Modify: `electron/src/nativeTerminal/NativeTerminalHost.test.ts`
- Modify: `electron/src/main.ts` (the `getReplaySnapshot` dep passes the frame through unchanged)

**Interfaces:**
- Consumes: `SessionManager.getReplaySnapshot(id): SessionReplayFrame | undefined` where `SessionReplayFrame = { data: string; alternate: boolean; appMouse: boolean; sgr: boolean }` (`server/src/services/SessionManager.ts:236`).
- Produces: `HostDeps.getReplaySnapshot(id): ReplaySnapshot | undefined` with `ReplaySnapshot = { data: string; alternate: boolean }`. Later tasks rely on this widened shape.

- [ ] **Step 1: Write the failing test**

Add to `electron/src/nativeTerminal/NativeTerminalHost.test.ts`. Extend the existing `harness()` so the snapshot is configurable:

```ts
test('an alt-screen session is seeded onto the alternate buffer', () => {
  // A session already inside vim/htop must not have its alt-screen content
  // painted into the normal buffer — the view would show a garbled mix until
  // the next full repaint.
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon, { data: 'VIMSCREEN', alternate: true });
  host.attach('s1', HANDLE, RECT);
  const fed = calls.filter((c) => c.startsWith('feed:1:')).join('|');
  assert.ok(fed.includes('\x1b[?1049h'), `expected an alt-buffer switch before the seed, got ${fed}`);
  assert.ok(fed.includes('VIMSCREEN'));
});

test('a normal-screen session is seeded without an alt-buffer switch', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon, { data: 'PLAIN', alternate: false });
  host.attach('s1', HANDLE, RECT);
  const fed = calls.filter((c) => c.startsWith('feed:1:')).join('|');
  assert.ok(fed.includes('PLAIN'));
  assert.ok(!fed.includes('\x1b[?1049h'), 'must not switch buffers for a normal-screen session');
});
```

Update `harness()` to accept an optional snapshot, defaulting to the existing `{ data: 'REPLAY', alternate: false }`, and update the existing replay-seed test's expectation if it asserts an exact feed string.

- [ ] **Step 2: Run and confirm failure**

```bash
npx tsx --test electron/src/nativeTerminal/NativeTerminalHost.test.ts
```
Expected: FAIL — no alt-buffer switch is emitted.

- [ ] **Step 3: Widen the type**

In `types.ts`:

```ts
/** What the host needs from a session's replay frame. `alternate` matters
 *  because seeding alt-screen content into the normal buffer renders garbled. */
export interface ReplaySnapshot { data: string; alternate: boolean }
```

and change `HostDeps.getReplaySnapshot` to `(id: string) => ReplaySnapshot | undefined`.

- [ ] **Step 4: Emit the buffer switch**

In `NativeTerminalHost.attach()`, replace the seed block's body:

```ts
        const snap = this.deps.getReplaySnapshot(sessionId);
        if (snap) {
          // Enter the alternate buffer BEFORE the seed when the session is in
          // one, so the frame lands where the agent actually drew it.
          const prefix = snap.alternate ? '\x1b[?1049h' : '';
          this.addon.feed(id, Buffer.from(prefix + snap.data, 'utf8'));
        }
```

- [ ] **Step 5: Pass the real frame through in main**

`main.ts`'s dep currently narrows. It already returns the SessionManager frame, which structurally satisfies `ReplaySnapshot` — confirm no cast is needed and the build is clean.

- [ ] **Step 6: Run tests**

```bash
npx tsx --test electron/src/nativeTerminal/NativeTerminalHost.test.ts
npm run build:all
```
Expected: all PASS, build exit 0.

- [ ] **Step 7: Commit**

```bash
git add electron/src/nativeTerminal server/src/services/SessionManager.ts electron/src/main.ts
git commit -m "fix(electron): seed alt-screen state when attaching a native overlay"
```

---

## Task 2: Reparent an overlay between windows

`attach()` reuses an overlay by `sessionId` and ignores `parentHandle` on the reuse path, while the addon calls Swift `attachTo:` exactly once at creation. A session moved to a second window keeps an overlay parented to the first. Multi-window is a shipped Argus feature, so this must work before Mosaic.

**Files:**
- Modify: `native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift`
- Modify: `native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift`
- Modify: `native/addon/src/addon.mm`
- Modify: `electron/src/nativeTerminal/types.ts`
- Modify: `electron/src/nativeTerminal/NativeTerminalHost.ts`
- Modify: `electron/src/nativeTerminal/NativeTerminalHost.test.ts`

**Interfaces:**
- Produces: Swift `@objc public func reparent(to parent: NSWindow)` → ObjC selector `reparentTo:`; addon export `reparent(id: number, parentHandle: Buffer): void`; host tracks the current parent per session and reparents when it changes.

- [ ] **Step 1: Write the failing Swift test**

Add to `ShimTests.swift`:

```swift
  func testAttachTwiceDoesNotLeakTheFirstWindow() {
    // attach(to:) previously had no guard: a second call overwrote `window`,
    // orphaning a real NSWindow with no reference to close it.
    let c = OverlayController(width: 200, height: 100)
    let a = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                     styleMask: [.titled], backing: .buffered, defer: false)
    let b = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                     styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: a)
    let first = c.debugWindowNumber()
    c.attach(to: b)
    XCTAssertEqual(c.debugWindowNumber(), first, "a second attach must not create a second window")
    XCTAssertEqual(c.debugParentWindowNumber(), b.windowNumber, "it must reparent instead")
  }

  func testReparentMovesTheChildToTheNewParent() {
    let c = OverlayController(width: 200, height: 100)
    let a = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                     styleMask: [.titled], backing: .buffered, defer: false)
    let b = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                     styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: a)
    XCTAssertEqual(c.debugParentWindowNumber(), a.windowNumber)
    c.reparent(to: b)
    XCTAssertEqual(c.debugParentWindowNumber(), b.windowNumber)
    XCTAssertFalse(a.childWindows?.contains(where: { $0.windowNumber == c.debugWindowNumber() }) ?? false,
                   "the old parent must no longer own the child")
  }
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd native/ArgusTerminal && swift test
```
Expected: FAIL — `reparent`, `debugWindowNumber`, `debugParentWindowNumber` not found.

- [ ] **Step 3: Implement in Swift**

In `OverlayController.swift`, make `attach` idempotent and add `reparent`, plus the two test seams:

```swift
  @objc public func attach(to parent: NSWindow) {
    // Idempotent: a second attach reparents rather than orphaning the first
    // window. Without this, the old window leaks with nothing referencing it.
    if window != nil {
      reparent(to: parent)
      return
    }
    let w = KeyableWindow(contentRect: terminalView.frame,
                          styleMask: [.borderless], backing: .buffered, defer: false)
    w.contentView = terminalView
    w.isOpaque = true
    w.hasShadow = false
    w.ignoresMouseEvents = false
    parent.addChildWindow(w, ordered: .above)
    window = w
  }

  /// Move an existing overlay to a different parent window. Argus supports
  /// multiple windows and a session can move between them.
  @objc public func reparent(to parent: NSWindow) {
    guard let w = window else { return }
    w.parent?.removeChildWindow(w)
    parent.addChildWindow(w, ordered: .above)
  }

  // Test seams — not @objc, so invisible across the ObjC++ boundary.
  public func debugWindowNumber() -> Int { window.map { Int($0.windowNumber) } ?? -1 }
  public func debugParentWindowNumber() -> Int { window?.parent.map { Int($0.windowNumber) } ?? -1 }
```

- [ ] **Step 4: Run Swift tests**

```bash
cd native/ArgusTerminal && swift test
```
Expected: 7 PASS.

- [ ] **Step 5: Expose `reparent` in the addon**

In `addon.mm`, beside `SetFrame`, following the same validation shape (`Create` and `SetFrame` throw on bad input; match them):

```objc
Napi::Value Reparent(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsBuffer()) {
    Napi::TypeError::New(env, "reparent(id, parentHandle) requires a Buffer handle")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto buf = info[1].As<Napi::Buffer<char>>();
  if (buf.Length() < sizeof(void*)) {
    Napi::TypeError::New(env, "reparent(id, parentHandle): handle too small")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  OverlayController* c = Lookup(info, nullptr);
  if (c) {
    NSView* view = *reinterpret_cast<NSView* __unsafe_unretained*>(buf.Data());
    [c reparentTo:[view window]];
  }
  return env.Undefined();
}
```

and register it: `exports.Set("reparent", Napi::Function::New(env, Reparent));`

- [ ] **Step 6: Rebuild and smoke the addon**

```bash
cd native/ArgusTerminal && swift build -c release && cd ../..
npx node-gyp rebuild --directory=native/addon \
  --target=$(node -p "require('electron/package.json').version") \
  --dist-url=https://electronjs.org/headers
ELECTRON_RUN_AS_NODE=1 npx electron -e "const a=require('./native/addon/build/Release/argus_native_terminal.node'); console.log(Object.keys(a).length, Object.keys(a).includes('reparent'));"
```
Expected: `10 true`.

- [ ] **Step 7: Write the failing host test**

```ts
test('attaching a session to a different window reparents its overlay', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT);
  host.attach('s1', winB, RECT);
  assert.equal(calls.filter((c) => c.startsWith('create:')).length, 1, 'must not create a second overlay');
  assert.ok(calls.some((c) => c.startsWith('reparent:1')), `expected a reparent, got ${calls.join(',')}`);
});

test('re-attaching to the SAME window does not reparent', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  host.attach('s1', winA, RECT);
  host.attach('s1', winA, RECT);
  assert.ok(!calls.some((c) => c.startsWith('reparent:')), 'a same-window re-attach is just a setFrame');
});
```

Extend `fakeAddon()` with `reparent: (id, h) => calls.push(\`reparent:${id}\`)`.

- [ ] **Step 8: Implement in the host**

Add `reparent(id: number, parentHandle: Buffer): void` to `NativeTerminalAddon`. Track the parent per session and compare on the reuse path:

```ts
  private readonly parentBySession = new Map<string, string>();
```

In `attach()`, after resolving `id` on the reuse path:

```ts
    // A session can move between Argus windows; the overlay must follow it.
    const parentKey = parentHandle.toString('base64');
    if (this.parentBySession.get(sessionId) !== parentKey) {
      try {
        this.addon.reparent(id, parentHandle);
      } catch (err) {
        console.error('[native-term] reparent failed for', sessionId, err);
      }
      this.parentBySession.set(sessionId, parentKey);
    }
```

Set it on create too, and delete it in `detach()` alongside the other maps.

- [ ] **Step 9: Run tests**

```bash
npx tsx --test electron/src/nativeTerminal/NativeTerminalHost.test.ts
npm run build:all
```
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add native electron/src/nativeTerminal
git commit -m "feat(native): reparent overlays when a session moves between windows"
```

---

## Task 3: Detach explicitly when a session exits

Nothing calls `detach()` when a session exits or is deleted — cleanup relies entirely on React unmounting the tile. That happens to work, but it is implicit and untested, and with Mosaic there will be many overlays.

**Files:**
- Modify: `electron/src/main.ts`
- Modify: `electron/src/nativeTerminal/NativeTerminalHost.test.ts`

**Interfaces:**
- Consumes: `SessionManager.onSessionDeleted?: (id: string) => void` (`server/src/services/SessionManager.ts:363`, fired at `:697`). It is a **single assignable callback, already claimed** by `server/src/index.ts:171` — so you MUST chain it. Overwriting silently breaks the existing handler.

- [ ] **Step 1: Write the failing host test**

```ts
test('detach is idempotent and safe for a session that already exited', () => {
  // Session exit and tile unmount can both fire; neither must throw or
  // double-destroy.
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.detach('s1');
  host.detach('s1');
  assert.equal(calls.filter((c) => c.startsWith('destroy:')).length, 1);
});
```

- [ ] **Step 2: Run and confirm it passes or fails**

```bash
npx tsx --test electron/src/nativeTerminal/NativeTerminalHost.test.ts
```
If it already passes, say so in the report — the host's early-return may already give idempotency. The test still earns its place as a regression guard for the new caller in Step 3.

- [ ] **Step 3: Wire session exit in main**

Where the server is wired in `main.ts`, chain the native detach onto the existing deletion hook. `onSessionDeleted` is a single assignable property that `server/src/index.ts:171` already sets, so capture and call through — do not overwrite:

```ts
// A session that exits or is deleted must drop its overlay immediately rather
// than waiting for React to unmount the tile — with Mosaic there can be many.
const priorOnSessionDeleted = sm.onSessionDeleted;
sm.onSessionDeleted = (id: string) => {
  try {
    nativeTerminal.detach(id);
  } catch (err) {
    console.error('[native-term] detach on session delete failed for', id, err);
  }
  priorOnSessionDeleted?.(id);
};
```

Also untrack it from the window bookkeeping added in Phase 1 (`untrackNativeTermSession`), so a closed window does not later try to detach a session that is already gone.

- [ ] **Step 4: Verify**

```bash
npx tsx --test electron/src/nativeTerminal/NativeTerminalHost.test.ts
npm run build:all
```
Then boot with `ARGUS_NATIVE_TERM=1`, create a session, attach an overlay, delete the session, and show the detach log line. Use the app's built-in dev isolation; never touch the user's running instance.

- [ ] **Step 5: Commit**

```bash
git add electron/src
git commit -m "fix(electron): detach a native overlay when its session exits"
```

---

## Task 4: Fall back to xterm.js when attach fails

The renderer decides `useNative` once from a global `available()` check. If `create()` fails for one session, the user gets a permanently blank transparent hole with no way back. Attach failure must degrade that session to xterm.js.

**Files:**
- Modify: `electron/src/nativeTerminal/NativeTerminalHost.ts` (+ `.test.ts`)
- Modify: `electron/src/main.ts`, `electron/src/preload.ts`
- Modify: `client/src/hooks/useNativeOverlayRect.ts` (+ `.test.tsx`)
- Modify: `client/src/app/ui/TerminalShell.tsx`

**Interfaces:**
- Produces: `NativeTerminalHost.attach(...): boolean` (true when an overlay is live). IPC `native-term:attach` becomes `ipcMain.handle` (invoke) returning `boolean`. Preload `attach(sessionId, rect): Promise<boolean>`. `useNativeOverlayRect(sessionId, enabled, onFailure?)` calls `onFailure()` when attach resolves false.

- [ ] **Step 1: Write the failing host test**

```ts
test('attach reports failure when create throws', () => {
  const { addon } = fakeAddon();
  addon.create = () => { throw new Error('no window'); };
  const { host } = harness(addon);
  assert.equal(host.attach('s1', HANDLE, RECT), false);
});

test('attach reports success on the happy path and on reuse', () => {
  const { addon } = fakeAddon();
  const { host } = harness(addon);
  assert.equal(host.attach('s1', HANDLE, RECT), true);
  assert.equal(host.attach('s1', HANDLE, RECT), true);
});

test('attach reports failure when the addon is unavailable', () => {
  const { host } = harness(null);
  assert.equal(host.attach('s1', HANDLE, RECT), false);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx tsx --test electron/src/nativeTerminal/NativeTerminalHost.test.ts
```
Expected: FAIL — `attach` currently returns `void`.

- [ ] **Step 3: Return a result from the host**

Change `attach`'s signature to `: boolean`. Return `false` from the `!this.addon` guard and from the `create()` catch; return `true` at the end. Post-create failures (seed/setFrame/show) still return `true` — the overlay exists and is recoverable, which is the Phase 1 rollback decision.

- [ ] **Step 4: Make the IPC channel awaitable**

In `main.ts`, change the attach registration from `ipcMain.on` to:

```ts
ipcMain.handle('native-term:attach', (e, { sessionId, rect }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  const ok = nativeTerminal.attach(sessionId, win.getNativeWindowHandle(), rect);
  if (ok) trackNativeTermAttach(sessionId, win);
  return ok;
});
```

Note the tracking now happens only on success — that also resolves the Phase 1 minor where bookkeeping registered regardless of availability.

In `preload.ts`, change attach to `ipcRenderer.invoke(...)` returning `Promise<boolean>`.

- [ ] **Step 5: Write the failing renderer test**

Add to `client/src/hooks/useNativeOverlayRect.test.tsx`:

```tsx
it('calls onFailure when the main process reports attach failed', async () => {
  api.attach.mockResolvedValueOnce(false);
  const onFailure = vi.fn();
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  await act(async () => { root.render(<Probe enabled onFailure={onFailure} />); });
  expect(onFailure).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});

it('does not call onFailure when attach succeeds', async () => {
  api.attach.mockResolvedValueOnce(true);
  const onFailure = vi.fn();
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  await act(async () => { root.render(<Probe enabled onFailure={onFailure} />); });
  expect(onFailure).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
```

Update the shared `api` mock so `attach` is a promise-returning `vi.fn()` defaulting to `true`, and extend `Probe` to forward `onFailure`.

- [ ] **Step 6: Implement in the hook**

`useNativeOverlayRect(sessionId, enabled, onFailure?)`. Await the attach result; if false, call `onFailure?.()` and skip installing observers and listeners — there is no overlay to track. Guard against a resolution arriving after unmount with a cancelled flag.

- [ ] **Step 7: Fall back in TerminalShell**

`TerminalShellNativeHole` gains local state: on failure it renders the xterm shell instead. Because the router picks by component type, flipping this remounts into `TerminalShellXterm` cleanly.

```tsx
function TerminalShellNativeHole(props: TerminalShellProps) {
  const [failed, setFailed] = useState(false);
  const holeRef = useNativeOverlayRect(props.session.id, !failed, () => setFailed(true));
  if (failed) return <TerminalShellXterm {...props} />;
  return <div ref={holeRef} style={{ flex: 1, minHeight: 0, background: 'transparent' }} />;
}
```

Note `TerminalShellNativeHole` now needs the full props, not just `sessionId` — update the router call site accordingly.

- [ ] **Step 8: Run everything**

```bash
npx tsx --test electron/src/nativeTerminal/NativeTerminalHost.test.ts
npx vitest run src/hooks/useNativeOverlayRect.test.tsx --root client
npm run lint -w client && npm test -w client && npm run build:all
```
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add electron/src client/src
git commit -m "feat: fall back to xterm.js when a native overlay fails to attach"
```

---

## Task 5: Overlay registry and suppression store

A child `NSWindow` always paints above its parent's web content — measured in Gate A (`child order[0]`, `parent order[1]`, same layer). So any DOM surface that overlaps an overlay must hide it. Blanket-hiding every terminal for a tooltip is unacceptable, so suppression is intersection-based and refcounted.

**Files:**
- Create: `client/src/hooks/nativeOverlayRegistry.ts`
- Create: `client/src/hooks/nativeOverlayRegistry.test.ts`
- Modify: `client/src/hooks/useNativeOverlayRect.ts`

**Interfaces:**
- Produces:
  - `registerOverlay(sessionId: string, rect: Rect): void`
  - `unregisterOverlay(sessionId: string): void`
  - `suppress(target: 'all' | Rect): SuppressionHandle` where `interface SuppressionHandle { ids: string[]; release(): void }` — hides overlapping overlays and returns a handle that knows how to undo itself. A single self-releasing token instead of paired functions, because a `suppress('all')` released with the wrong function would silently leak a suppression and leave terminals invisible.
  - `setSuppressionTransport(t: { hide(id: string): void; show(id: string): void }): void` — injected so tests need no IPC
  - `resetOverlayRegistryForTests(): void`

- [ ] **Step 1: Write the failing tests**

```ts
// client/src/hooks/nativeOverlayRegistry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerOverlay, unregisterOverlay, suppress,
  setSuppressionTransport, resetOverlayRegistryForTests,
} from './nativeOverlayRegistry.js';

const A = { x: 0, y: 0, width: 100, height: 100 };
const B = { x: 200, y: 0, width: 100, height: 100 };

let hidden: string[];
let shown: string[];
beforeEach(() => {
  resetOverlayRegistryForTests();
  hidden = []; shown = [];
  setSuppressionTransport({ hide: (id) => hidden.push(id), show: (id) => shown.push(id) });
});

describe('nativeOverlayRegistry', () => {
  it('suppresses only overlays the surface actually overlaps', () => {
    registerOverlay('a', A);
    registerOverlay('b', B);
    const got = suppress({ x: 50, y: 50, width: 20, height: 20 });   // inside A only
    expect(got.ids).toEqual(['a']);
    expect(hidden).toEqual(['a']);
  });

  it("suppresses everything for a full-screen surface", () => {
    registerOverlay('a', A);
    registerOverlay('b', B);
    expect(suppress('all').ids.sort()).toEqual(['a', 'b']);
  });

  it('refcounts: a second overlapping surface does not re-hide, and the first release does not restore', () => {
    registerOverlay('a', A);
    const s1 = suppress('all');
    const s2 = suppress('all');
    expect(hidden).toEqual(['a']);          // hidden once, not twice
    s1.release();
    expect(shown).toEqual([]);              // still one holder
    s2.release();
    expect(shown).toEqual(['a']);           // now restored
  });

  it('an overlay registered while suppressed is hidden immediately', () => {
    const s = suppress('all');
    registerOverlay('late', A);
    expect(hidden).toEqual(['late']);
    s.release();
    expect(shown).toEqual(['late']);
  });

  it('unregistering a suppressed overlay does not later show a dead overlay', () => {
    registerOverlay('a', A);
    const s = suppress('all');
    unregisterOverlay('a');
    s.release();
    expect(shown).toEqual([]);
  });

  it('touching edges do not count as an overlap', () => {
    registerOverlay('a', A);          // 0..100
    expect(suppress({ x: 100, y: 0, width: 10, height: 10 }).ids).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/hooks/nativeOverlayRegistry.test.ts --root client
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

Module-level state (one renderer, one registry). Key points: `intersects` uses strict inequality so touching edges do not overlap; a newly registered overlay is hidden immediately if anything is currently suppressing; `release` only shows overlays still registered.

```ts
// client/src/hooks/nativeOverlayRegistry.ts
export interface Rect { x: number; y: number; width: number; height: number }

interface Transport { hide(sessionId: string): void; show(sessionId: string): void }

const rects = new Map<string, Rect>();
const holders = new Map<string, number>();   // sessionId -> suppression refcount
let activeAll = 0;                            // count of full-screen suppressors
let transport: Transport = { hide: () => {}, show: () => {} };

export function setSuppressionTransport(t: Transport): void { transport = t; }

export function resetOverlayRegistryForTests(): void {
  rects.clear(); holders.clear(); activeAll = 0;
  transport = { hide: () => {}, show: () => {} };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
      && a.y < b.y + b.height && b.y < a.y + a.height;
}

function hold(sessionId: string): void {
  const n = (holders.get(sessionId) ?? 0) + 1;
  holders.set(sessionId, n);
  if (n === 1) transport.hide(sessionId);
}

export function registerOverlay(sessionId: string, rect: Rect): void {
  rects.set(sessionId, rect);
  // A tile that appears while a sheet is open must not flash over it.
  if (activeAll > 0) hold(sessionId);
}

export function unregisterOverlay(sessionId: string): void {
  rects.delete(sessionId);
  holders.delete(sessionId);
}

export interface SuppressionHandle { ids: string[]; release(): void }

/** Hide every overlay this surface covers. The returned handle is the ONLY way
 *  to undo it — a single token rather than paired suppress/release functions,
 *  so a caller cannot release a full-screen suppression with the wrong one and
 *  silently leave terminals invisible forever. */
export function suppress(target: 'all' | Rect): SuppressionHandle {
  const isAll = target === 'all';
  if (isAll) activeAll += 1;
  const ids = isAll
    ? [...rects.keys()]
    : [...rects.entries()].filter(([, r]) => intersects(r, target)).map(([id]) => id);
  for (const id of ids) hold(id);

  let released = false;
  return {
    ids,
    release() {
      if (released) return;        // double-release must not decrement twice
      released = true;
      if (isAll) activeAll = Math.max(0, activeAll - 1);
      for (const id of ids) {
        const n = holders.get(id);
        if (n === undefined) continue;          // unregistered while suppressed
        if (n <= 1) { holders.delete(id); if (rects.has(id)) transport.show(id); }
        else holders.set(id, n - 1);
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/hooks/nativeOverlayRegistry.test.ts --root client
```
Expected: 6 PASS.

- [ ] **Step 5: Register from the rect hook**

In `useNativeOverlayRect`, call `registerOverlay(sessionId, rect)` on attach and on every reported move, and `unregisterOverlay(sessionId)` in cleanup.

- [ ] **Step 6: Run the hook tests and commit**

```bash
npx vitest run src/hooks --root client
git add client/src/hooks
git commit -m "feat(client): intersection-based overlay suppression registry"
```

---

## Task 6: The suppression hook and its contract test

**Files:**
- Create: `client/src/hooks/useOverlaySuppression.ts`
- Create: `client/src/hooks/useOverlaySuppression.test.tsx`
- Create: `client/src/hooks/overlaySuppressionContract.test.ts`
- Modify: `client/src/components/primitives/Sheet.tsx`, `AlertSheet.tsx`, `ContextMenu.tsx`, `Tooltip.tsx`, `Toast.tsx`
- Modify: `client/src/app/overlays/Overlay.tsx`, `MergePreviewSheet.tsx`
- Modify: `electron/src/main.ts`, `electron/src/preload.ts`

**Interfaces:**
- Produces: `useOverlaySuppression(target: 'all' | (() => Rect | null))` — suppresses on mount, releases on unmount. Pass `'all'` for full-screen dimmers, a rect getter for positioned popovers.

- [ ] **Step 1: Add the IPC transport**

`main.ts`: `ipcMain.on('native-term:suppress', (_e, { sessionId }) => nativeTerminal.hide(sessionId))` and a matching `native-term:unsuppress` calling `show`. `preload.ts`: expose `suppress(sessionId)` / `unsuppress(sessionId)` on `electronNativeTerminal`.

Wire the transport once, where the app boots the renderer (alongside the existing native-terminal setup in `Focus.tsx` or better, a top-level effect in `ArgusApp`), via `setSuppressionTransport({ hide, show })`. With the flag off, `window.electronNativeTerminal` calls are inert no-ops, so no guard is needed — but confirm that and say so in the report.

- [ ] **Step 2: Write the failing hook tests**

```tsx
// client/src/hooks/useOverlaySuppression.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useOverlaySuppression } from './useOverlaySuppression.js';
import {
  registerOverlay, setSuppressionTransport, resetOverlayRegistryForTests,
} from './nativeOverlayRegistry.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined }

let hidden: string[]; let shown: string[];
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  resetOverlayRegistryForTests();
  hidden = []; shown = [];
  setSuppressionTransport({ hide: (id) => hidden.push(id), show: (id) => shown.push(id) });
});

function Surface({ target }: { target: 'all' | (() => { x: number; y: number; width: number; height: number } | null) }) {
  useOverlaySuppression(target);
  return null;
}

function mount(el: React.ReactElement) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => root.render(el));
  return () => act(() => root.unmount());
}

describe('useOverlaySuppression', () => {
  it('hides all overlays for a full-screen surface and restores on unmount', () => {
    registerOverlay('a', { x: 0, y: 0, width: 10, height: 10 });
    const unmount = mount(<Surface target="all" />);
    expect(hidden).toEqual(['a']);
    unmount();
    expect(shown).toEqual(['a']);
  });

  it('hides only the overlapping overlay for a positioned surface', () => {
    registerOverlay('a', { x: 0, y: 0, width: 100, height: 100 });
    registerOverlay('b', { x: 500, y: 0, width: 100, height: 100 });
    const unmount = mount(<Surface target={() => ({ x: 10, y: 10, width: 5, height: 5 })} />);
    expect(hidden).toEqual(['a']);
    unmount();
  });

  it('two surfaces at once keep an overlay hidden until both close', () => {
    registerOverlay('a', { x: 0, y: 0, width: 10, height: 10 });
    const close1 = mount(<Surface target="all" />);
    const close2 = mount(<Surface target="all" />);
    close1();
    expect(shown).toEqual([]);
    close2();
    expect(shown).toEqual(['a']);
  });
});
```

- [ ] **Step 3: Run and confirm failure**

```bash
npx vitest run src/hooks/useOverlaySuppression.test.tsx --root client
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the hook**

```ts
// client/src/hooks/useOverlaySuppression.ts
import { useEffect } from 'react';
import { suppress, type Rect } from './nativeOverlayRegistry.js';

/**
 * Hide any native terminal overlay this surface would cover. A child NSWindow
 * always paints above the parent's web content (measured: Gate A), so without
 * this a modal, palette or menu renders UNDERNEATH a native terminal.
 *
 * Pass 'all' for a full-screen dimmer, or a getter returning the surface's
 * viewport rect for a positioned popover — hiding every terminal to show a
 * tooltip would be absurd.
 */
export function useOverlaySuppression(target: 'all' | (() => Rect | null)): void {
  useEffect(() => {
    const isAll = target === 'all';
    const rect = isAll ? null : target();
    if (!isAll && !rect) return;
    const handle = suppress(isAll ? 'all' : rect!);
    return () => handle.release();
    // Intentionally mount/unmount only: a surface's lifetime is the suppression
    // window. A moving popover re-suppressing per frame would thrash the IPC.
     
  }, []);
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/hooks/useOverlaySuppression.test.tsx --root client
```
Expected: 3 PASS.

- [ ] **Step 6: Write the contract test**

This is the guard that stops a future overlay silently rendering beneath a terminal.

```ts
// client/src/hooks/overlaySuppressionContract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

// Every component that paints above --z-pop sits above the web content that a
// native overlay also covers — so each must suppress. Measured in Gate A: a
// child NSWindow always orders above its parent's content.
const Z_TIERS = ['--z-pop', '--z-sheet', '--z-tooltip', '--z-overlay', '--z-toast'];

describe('overlay suppression contract', () => {
  it('every component rendering above --z-pop calls useOverlaySuppression', () => {
    const files = globSync('src/**/*.tsx', { cwd: new URL('../..', import.meta.url).pathname });
    const offenders: string[] = [];
    for (const f of files) {
      if (f.includes('.test.')) continue;
      const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf-8');
      const paints = Z_TIERS.some((t) => src.includes(t));
      if (paints && !src.includes('useOverlaySuppression')) offenders.push(f);
    }
    expect(offenders, `these paint above --z-pop but never suppress overlays:\n${offenders.join('\n')}`).toEqual([]);
  });
});
```

If `globSync` is unavailable in this Node/Vitest combination, use `fast-glob` if already a dependency, or walk `src/` with `readdirSync({ recursive: true })` — do not weaken the test to a hardcoded file list, since the whole point is catching files nobody remembered.

- [ ] **Step 7: Run it and see the real offenders**

```bash
npx vitest run src/hooks/overlaySuppressionContract.test.ts --root client
```
Expected: FAIL, listing the seven known components. Record the list in the report — if it names more than the seven expected, that is a finding worth reporting.

- [ ] **Step 8: Wire each component**

Add `useOverlaySuppression('all')` to `Overlay.tsx`, `Sheet.tsx`, `AlertSheet.tsx`, `MergePreviewSheet.tsx` (full-screen dimmers). Add a rect-based call to `ContextMenu.tsx`, `Tooltip.tsx`, `Toast.tsx`, using each one's existing positioning ref:

```ts
  useOverlaySuppression(() => panelRef.current?.getBoundingClientRect() ?? null);
```

Match each file's existing ref name; do not add refs where one already exists.

- [ ] **Step 9: Verify the contract passes and nothing regressed**

```bash
npx vitest run src/hooks --root client
npm run lint -w client && npm test -w client && npm run build:all
```
Expected: contract PASSES, full client suite green.

- [ ] **Step 10: Commit**

```bash
git add client/src electron/src
git commit -m "feat(client): suppress native overlays behind DOM surfaces"
```

---

## Task 7: Mosaic

**Files:**
- Create: `client/src/hooks/useNativeEngine.ts`
- Modify: `client/src/app/views/Focus.tsx`, `client/src/app/views/Mosaic.tsx`

**Interfaces:**
- Produces: `useNativeEngine(): boolean` — the shared "native requested AND available" decision, replacing the copy currently inline in `Focus.tsx:120-134`.

- [ ] **Step 1: Extract the decision**

```ts
// client/src/hooks/useNativeEngine.ts
import { useEffect, useState } from 'react';

/** True when the native terminal engine is both requested (build flag) and
 *  actually available (addon loaded in main). Focus and Mosaic must agree, so
 *  the decision lives in one place. */
export function useNativeEngine(): boolean {
  const requested = import.meta.env.VITE_ARGUS_NATIVE_TERM === '1';
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!requested) return;
    const api = (window as Window & {
      electronNativeTerminal?: { available: () => Promise<boolean> };
    }).electronNativeTerminal;
    if (!api) return;
    let cancelled = false;
    api.available().then((ok) => { if (!cancelled) setAvailable(ok); }).catch(() => {});
    return () => { cancelled = true; };
  }, [requested]);
  return requested && available;
}
```

- [ ] **Step 2: Use it in Focus**

Replace the inline logic at `Focus.tsx:120-134` with `const useNativeTerminal = useNativeEngine();`, leaving the `useNative={useNativeTerminal}` prop at line 327 unchanged.

- [ ] **Step 3: Use it in Mosaic**

At `Mosaic.tsx:834`, add `useNative={nativeEngine}` to the `TerminalShell` props, with `const nativeEngine = useNativeEngine();` resolved in the component that owns that render. **Read the surrounding code first** — if line 834 sits inside a memoized leaf, call the hook in the parent and thread it through as a prop rather than calling a hook inside a `.map` callback.

- [ ] **Step 4: Verify no memo regression**

The repo treats `TerminalShell`'s memoization as load-bearing. Confirm the new prop is a stable boolean (not an object or a fresh closure) so it cannot bust memo on every parent render. State explicitly in your report how you confirmed this.

- [ ] **Step 5: Full verification**

```bash
npm run lint -w client && npm test -w client && npm run build:all
```
Then boot with both flags and confirm, in the log, that multiple overlays attach with distinct ids when several tiles are open — and that with the flags OFF the mosaic is byte-for-byte unchanged and silent.

- [ ] **Step 6: Commit**

```bash
git add client/src
git commit -m "feat(client): native terminal overlays in the mosaic"
```

---

## Definition of done

- All suites green: lint, server, client, `swift test`, `build:all`.
- Contract test passes and genuinely fails when a z-tier component drops the hook (verify by temporarily removing one, then restore).
- With both flags set: multiple Mosaic tiles render native overlays; opening the command palette hides the overlays it covers and restores them on close; moving a session between windows reparents its overlay; a session exiting drops its overlay.
- With flags unset: byte-for-byte the current app, zero `native-term` log lines.
