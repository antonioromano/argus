# Native Terminal Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a native (SwiftTerm) tile behave like an xterm.js tile — selection, scrolling, typing, font, zoom, history depth, geometry — and close the remaining lifecycle, CI and polish gaps found in the 2026-09-25 deep review.

**Architecture:** The Swift shim (`OverlayController`) currently leaves SwiftTerm on its library defaults wherever `useTerminal.ts` deliberately tuned xterm.js. Each fix sets the matching SwiftTerm option in the shim, exposes it through the N-API addon only when the value must come from JS (font size, scrollback), and keeps all policy in `NativeTerminalHost` (TypeScript, testable without a native build). Zoom is handled once, in the host: it stores CSS-px geometry and font size and scales both by the parent window's zoom factor at the addon boundary.

**Tech Stack:** Swift 5.9 + SwiftTerm 1.20.0 (SwiftPM), ObjC++ N-API addon (node-addon-api), Electron main (TypeScript, node:test), React renderer (Vitest), Express/Socket.io server (node:test).

**Spec:** The review findings, reproduced in the "Findings" section below (source: deep review in session of 2026-09-25; evidence gathered there is quoted inline).

## Findings (the spec)

| # | Finding | Evidence |
|---|---------|----------|
| F1 | Mouse reporting always on in SwiftTerm: plain drag does not select, wheel never scrolls SwiftTerm history, wheel reports are injected into the pane via `send-keys -l` | tmux 3.6b with `mouse on` emits `?1000h ?1002h ?1006h` to the outer terminal even for `sh`; `TerminalMirror.serialize()` re-emits `?1002h ?1006h`; SwiftTerm `allowMouseReporting` defaults `true` |
| F2 | Option acts as Meta — breaks `@ # [ ] { }` on non-US layouts | SwiftTerm `optionAsMetaKey = true` (MacTerminalView.swift:1545); xterm uses `macOptionIsMeta: false` |
| F3 | Font size setting ignored; different font from xterm | SwiftTerm default `monospacedSystemFont(ofSize: NSFont.systemFontSize)`; xterm uses `codeFontSize` |
| F4 | Scrollback 500 vs xterm 5000; seed truncated | SwiftTerm `TerminalOptions.default.scrollback = 500`; `useTerminal.ts` `scrollback: 5000` |
| F5 | A phone viewer leaves a natively viewed session stuck at phone width | `getSessionDimensions` sizes to the smallest mobile socket; on leave no socket dims → idle path (suppressed for native) → pty never restored; SwiftTerm never re-reports |
| F6 | CI never builds the addon nor runs `swift test` | `.github/workflows/ci.yml` has no native step |
| F7 | OSC 52 clipboard writes dropped | `clipboardCopy` delegate empty — **parity with xterm** (no clipboard addon); document, do not implement |
| F8 | Possible overlay jitter while dragging the parent window | `restoreAppliedFrameIfMovedExternally` snaps a parent-carried child back to a frame computed against the old parent position |
| F9 | VoiceOver cannot read native tiles | `KeyableWindow` opts out of AX entirely to hide from window managers |
| F10 | Shift+Enter intercepted before IME composition | `KeyableWindow.sendEvent` runs before `NSTextInputClient` |
| F11 | `gridCols` doc comment splits `setFrame`'s doc comment | commit 20f2559 |
| F12 | Page zoom (⌘+ / ⌘−) mis-sizes and mis-places overlays and ignores zoom for font | `getBoundingClientRect` returns CSS px; zoom ≠ 1 makes CSS px ≠ AppKit points; `window.ts` `setZoomLevel` |

Wheel **forwarding** to mouse apps is deliberately not reimplemented natively: the xterm path forwards only on the alternate screen, and tmux runs with `smcup@:rmcup@`, so the outer terminal practically never is. With reporting off, SwiftTerm on an alt screen falls back to DECSET 1007 arrow keys — the same thing xterm does for a no-mouse pager.

## Global Constraints

- Node for all npm/test commands: `export PATH=~/.nvm/versions/node/v24.16.0/bin:$PATH` (`.nvmrc` = 24; the shell default v18 cannot run the server tests).
- Server and `electron/` code may only `import type` from `@argus/shared`; duplicated values go in `scripts/check-dep-sync.mjs` check 3.
- Pre-commit gate: `npm run verify`. Native gate: `swift test --package-path native/ArgusTerminal` and `npm run build:native -- --arch=arm64`.
- Every addon call from the host stays wrapped in try/catch (degrade, never throw).
- Commit messages: conventional commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Swift: SwiftTerm `keyDown`/`scrollWheel` are `public`, not `open` — never try to override them; intercept in `KeyableWindow.sendEvent`.

## Review Focus

1. **Zoom already non-zero when a tile attaches** (restored per-window zoom from `window.ts:206`) — the first frame and first font must already be scaled. Test in Task 4 (`attach after setZoom scales the first frame and font`).
2. **Seed carries mouse DECSETs** — reporting must stay off regardless of what the stream enables. Test in Task 1 (`reporting stays off after the stream enables mouse modes`).
3. **Phone connects, user then resizes the native tile, phone leaves** — restore the *latest* native size, not the first. Test in Task 5.
4. **Font size arrives before the overlay exists** (effect fires before async attach resolves) — must not be lost; attach carries the size. Test in Task 4 (client `attach receives the font size`).
5. **IME composition active and user presses Shift+Enter** — composition must be confirmed, not ESC CR sent. Test in Task 2.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift` | Modify | SwiftTerm options (mouse, option key, font, scrollback), IME guard, parent-move re-derive, AX spike, doc fixes |
| `native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift` | Modify | Swift tests for each shim change |
| `native/addon/src/addon.mm` | Modify | `create(handle, scrollback)`, `setFontSize(id, size)` |
| `electron/src/nativeTerminal/types.ts` | Modify | addon + deps surface |
| `electron/src/nativeTerminal/constants.ts` | Create | `TERMINAL_SCROLLBACK` (duplicated from client) |
| `electron/src/nativeTerminal/NativeTerminalHost.ts` | Modify | font size, zoom scaling, single `pushFrame` funnel |
| `electron/src/nativeTerminal/NativeTerminalHost.test.ts` | Modify | host tests |
| `electron/src/main.ts` | Modify | zoom wiring, font IPC, `resizeFromNative` wiring |
| `electron/src/preload.ts` | Modify | `attach(…, fontSize)`, `setFontSize` |
| `client/src/constants/terminal.ts` | Create | `TERMINAL_SCROLLBACK` |
| `client/src/hooks/useTerminal.ts` | Modify | use `TERMINAL_SCROLLBACK` |
| `client/src/hooks/useNativeOverlayRect.ts` (+ test) | Modify | pass font size on attach |
| `client/src/app/ui/TerminalShell.tsx` (+ `TerminalShell.native.test.tsx`) | Modify | font-size effect |
| `server/src/services/SessionManager.ts` (+ `SessionManager.geometry.test.ts`) | Modify | remember native size, restore it |
| `scripts/check-dep-sync.mjs` | Modify | register `TERMINAL_SCROLLBACK` pair |
| `.github/workflows/ci.yml` | Modify | native job |

---

### Task 1: Mouse — plain drag selects, wheel scrolls history (F1)

**Files:**
- Modify: `native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift` (init, ~line 236–252; test seams block ~line 501)
- Test: `native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift`

**Interfaces:**
- Produces: `public func debugAllowsMouseReporting() -> Bool` (test seam only).

- [ ] **Step 1: Write the failing tests**

Append inside `final class ShimTests` in `ShimTests.swift`:

```swift
  /// tmux runs with `mouse on`, so every session's stream (and replay seed)
  /// enables mouse reporting on the outer terminal. The xterm path swallows
  /// those modes so a plain drag selects text and the wheel scrolls history;
  /// the native view must do the same, or selection and scrollback are lost.
  func testMouseReportingIsOffSoDragSelectsAndWheelScrolls() {
    let c = OverlayController(width: 800, height: 480)
    XCTAssertFalse(c.debugAllowsMouseReporting())
  }

  func testReportingStaysOffAfterTheStreamEnablesMouseModes() {
    let c = OverlayController(width: 800, height: 480)
    c.feed(data: Data("\u{1b}[?1000h\u{1b}[?1002h\u{1b}[?1006h".utf8) as NSData)
    XCTAssertFalse(c.debugAllowsMouseReporting())
  }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path native/ArgusTerminal --filter ShimTests/testMouseReporting`
Expected: build FAILS with "value of type 'OverlayController' has no member 'debugAllowsMouseReporting'".

- [ ] **Step 3: Implement**

In `OverlayController.init`, after `terminalView.linkHighlightMode = .hover`:

```swift
    // tmux runs with `mouse on`, which enables mouse reporting (1000/1002/1006)
    // on the outer terminal for EVERY session — measured on tmux 3.6b even for
    // a bare `sh` — and the replay seed re-emits those modes. SwiftTerm honours
    // them by default, so a plain drag became a mouse report instead of a
    // selection and the wheel never reached SwiftTerm's own scrollback. The
    // xterm path swallows the same modes (terminalMouse.ts) for exactly this
    // reason; this is the native equivalent. Wheel forwarding to mouse apps is
    // not reproduced: xterm only forwards on the alternate screen, which the
    // outer terminal never enters with tmux's smcup stripped.
    terminalView.allowMouseReporting = false
```

In the test-seam block next to `debugCanBecomeKey()`:

```swift
  public func debugAllowsMouseReporting() -> Bool { terminalView.allowMouseReporting }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path native/ArgusTerminal`
Expected: all tests PASS (43).

- [ ] **Step 5: Commit**

```bash
git add native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift
git commit -m "$(cat <<'EOF'
fix(native-term): let a plain drag select and the wheel scroll history

tmux's `mouse on` enables mouse reporting on the outer terminal for every
session, and SwiftTerm honoured it: drags became mouse reports and the wheel
never scrolled SwiftTerm's scrollback. Turn reporting off, as the xterm path
does by swallowing the same modes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Keyboard and shim housekeeping (F2, F7, F10, F11)

**Files:**
- Modify: `native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift` (`KeyableWindow` ~line 9–89, init, `attach(to:)` ~line 290, `gridCols` doc ~line 396, `clipboardCopy` ~line 786)
- Test: `native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift`

**Interfaces:**
- Produces (test seams): `public func debugOptionAsMeta() -> Bool`, `public func debugSetMarkedText(_ text: String)`.

- [ ] **Step 1: Write the failing tests**

Find the existing Shift+Enter test in `ShimTests.swift` (search `debugSendKey`) to confirm the capture pattern, then append:

```swift
  /// On non-US layouts Option types real characters (Italian: @ = ⌥ò,
  /// # = ⌥à, [ ] = ⌥è ⌥+). As Meta, SwiftTerm sent ESC + letter instead, which
  /// broke Claude's @file mentions. xterm runs with macOptionIsMeta: false.
  func testOptionTypesCharactersInsteadOfActingAsMeta() {
    let c = OverlayController(width: 800, height: 480)
    XCTAssertFalse(c.debugOptionAsMeta())
  }

  /// Shift+Enter confirms an IME composition (Japanese, Chinese). Translating
  /// it to ESC CR mid-composition would throw the composition away.
  func testShiftEnterDuringCompositionIsLeftToTheInputMethod() {
    let c = OverlayController(width: 400, height: 240)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.show()
    var sent: [Data] = []
    c.onInput = { sent.append($0 as Data) }
    c.debugSetMarkedText("にほ")

    c.debugSendKey(keyCode: 36, flags: .shift)

    XCTAssertFalse(sent.contains(Data([0x1b, 0x0d])), "no ESC CR while composing")
  }

  func testShiftEnterWithoutCompositionStillSendsEscCr() {
    let c = OverlayController(width: 400, height: 240)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.show()
    var sent: [Data] = []
    c.onInput = { sent.append($0 as Data) }

    c.debugSendKey(keyCode: 36, flags: .shift)

    XCTAssertEqual(sent, [Data([0x1b, 0x0d])])
  }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path native/ArgusTerminal`
Expected: build FAILS — `debugOptionAsMeta` / `debugSetMarkedText` undefined.

- [ ] **Step 3: Implement**

(a) In `KeyableWindow`, add below `var onShiftEnter`:

```swift
  /// True while the input method holds uncommitted (marked) text. Shift+Return
  /// then belongs to the IME — it confirms the composition — so it must not be
  /// translated to ESC CR.
  var isComposingText: (() -> Bool)?
```

and change the first line of `sendEvent`:

```swift
    if event.type == .keyDown, KeyableWindow.isShiftReturn(event),
       !(isComposingText?() ?? false), let handler = onShiftEnter {
```

(b) In `attach(to:)`, after the `w.onShiftEnter = …` block:

```swift
    w.isComposingText = { [weak self] in self?.terminalView.hasMarkedText() ?? false }
```

(c) In `init`, after the `allowMouseReporting` line from Task 1:

```swift
    // Option must type the characters non-US layouts put on it (@ # [ ] { }
    // on Italian). xterm runs with macOptionIsMeta: false; match it.
    terminalView.optionAsMetaKey = false
```

(d) Seams, next to `debugAllowsMouseReporting`:

```swift
  public func debugOptionAsMeta() -> Bool { terminalView.optionAsMetaKey }
  public func debugSetMarkedText(_ text: String) {
    terminalView.setMarkedText(text, selectedRange: NSRange(location: (text as NSString).length, length: 0),
                               replacementRange: NSRange(location: NSNotFound, length: 0))
  }
```

(e) F11 — move the `gridCols`/`gridRows` block (the doc comment starting "The grid SwiftTerm has computed…" and both properties) so it sits ABOVE the `/// \`x\`/\`y\`/\`width\`/\`height\` are VIEWPORT coordinates…` doc comment, leaving `setFrame`'s doc comment contiguous with `setFrame`.

(f) F7 — replace `public func clipboardCopy(source: TerminalView, content: Data) {}` with:

```swift
  /// OSC 52 clipboard writes are ignored on purpose. The xterm path has no
  /// clipboard addon either, so terminal output cannot overwrite the user's
  /// clipboard in either engine; copying is a local selection + ⌘C.
  public func clipboardCopy(source: TerminalView, content: Data) {}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path native/ArgusTerminal`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift
git commit -m "$(cat <<'EOF'
fix(native-term): let Option type characters, and leave Shift+Enter to an active IME

SwiftTerm treats Option as Meta by default, so non-US layouts sent ESC+letter
for @ # [ ] { }. Match xterm's macOptionIsMeta: false. Shift+Return is no
longer translated to ESC CR while an input method is composing. Also fixes a
split doc comment and documents why OSC 52 is ignored (xterm parity).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Scrollback depth matches xterm (F4)

**Files:**
- Create: `client/src/constants/terminal.ts`, `electron/src/nativeTerminal/constants.ts`
- Modify: `client/src/hooks/useTerminal.ts:254`, `scripts/check-dep-sync.mjs:109-112`, `native/addon/src/addon.mm` (`Create`), `OverlayController.swift`, `electron/src/nativeTerminal/types.ts`, `NativeTerminalHost.ts` (`attach`)
- Test: `ShimTests.swift`, `NativeTerminalHost.test.ts`

**Interfaces:**
- Produces: `export const TERMINAL_SCROLLBACK = 5000` (both files); addon `create(parentHandle: Buffer, scrollback: number): number`; Swift `@objc public func setScrollback(_ lines: Int)`; seam `public func debugScrollbackLimit() -> Int`.

- [ ] **Step 1: Write the failing tests**

`ShimTests.swift`:

```swift
  /// SwiftTerm defaults to 500 lines; xterm keeps 5000, and the replay seed
  /// carries the mirror's full history — anything past the limit is dropped.
  func testScrollbackCanBeRaisedToMatchXterm() {
    let c = OverlayController(width: 800, height: 480)
    c.setScrollback(5000)
    XCTAssertEqual(c.debugScrollbackLimit(), 5000)
  }
```

`NativeTerminalHost.test.ts` — in `fakeAddon()`, change `create` to capture the argument:

```ts
    create: (_handle, scrollback) => {
      calls.push(`create:${next}`);
      createdWith.push(scrollback);
      if (failNext.create) { failNext.create = false; throw new Error('create failed'); }
      return next++;
    },
```

declare `const createdWith: number[] = [];` next to `const calls`, and add `createdWith` to the returned object. Then append:

```ts
test('overlays are created with the same scrollback depth as xterm tiles', () => {
  const { addon, createdWith } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  assert.deepEqual(createdWith, [5000]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `swift test --package-path native/ArgusTerminal` → FAIL (`setScrollback` undefined).
Run: `npm run test:electron` → FAIL (`createdWith` is `[undefined]`, TS error on create arity).

- [ ] **Step 3: Implement**

`client/src/constants/terminal.ts`:

```ts
/**
 * Scrollback lines every terminal keeps. Duplicated in
 * electron/src/nativeTerminal/constants.ts for the native engine (Electron
 * main cannot import renderer code); check:deps keeps the two in sync.
 */
export const TERMINAL_SCROLLBACK = 5000;
```

`electron/src/nativeTerminal/constants.ts`:

```ts
/**
 * Scrollback lines a native overlay keeps — the same depth as an xterm tile
 * (client/src/constants/terminal.ts; check:deps keeps them in sync). SwiftTerm
 * defaults to 500, which truncated the replay seed.
 */
export const TERMINAL_SCROLLBACK = 5000;
```

`useTerminal.ts`: add `import { TERMINAL_SCROLLBACK } from '../constants/terminal.js';` and replace `scrollback: 5000,` with `scrollback: TERMINAL_SCROLLBACK,`.

`scripts/check-dep-sync.mjs` — extend `DUPLICATED_CONSTS` (the `shared`/`server` keys are just the two file paths):

```js
  // Renderer ↔ Electron main: main cannot import renderer code either.
  { name: 'TERMINAL_SCROLLBACK', shared: 'client/src/constants/terminal.ts', server: 'electron/src/nativeTerminal/constants.ts' },
```

`OverlayController.swift`, next to `setFrame`:

```swift
  /// Lines of history SwiftTerm keeps. The host passes xterm's depth at create
  /// time so both engines hold the same history.
  @objc public func setScrollback(_ lines: Int) {
    terminalView.getTerminal().changeScrollback(lines)
  }
```

and seam: `public func debugScrollbackLimit() -> Int { terminalView.getTerminal().options.scrollback }`

`addon.mm` `Create`, after the buffer-length check:

```objc
  // Optional second argument: scrollback depth. Validated like setFrame's
  // geometry — an unchecked As<Number>() on a non-number is UB here.
  int scrollback = 0;
  if (info.Length() >= 2 && info[1].IsNumber()) {
    scrollback = info[1].As<Napi::Number>().Int32Value();
  }
```

and right after `OverlayController* c = [[OverlayController alloc] initWithWidth:800 height:480];`:

```objc
  if (scrollback > 0) [c setScrollback:scrollback];
```

`types.ts`: `create(parentHandle: Buffer, scrollback: number): number;`

`NativeTerminalHost.ts`: `import { TERMINAL_SCROLLBACK } from './constants.js';` and in `attach` change `id = this.addon.create(parentHandle);` to `id = this.addon.create(parentHandle, TERMINAL_SCROLLBACK);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path native/ArgusTerminal && npm run build:native -- --arch=arm64 && npm run check:deps && npm run test:electron && npm test -w client`
Expected: all PASS; check:deps prints `3 cross-boundary constant(s) in sync`.

- [ ] **Step 5: Commit**

```bash
git add client/src/constants/terminal.ts electron/src/nativeTerminal/constants.ts client/src/hooks/useTerminal.ts scripts/check-dep-sync.mjs native/addon/src/addon.mm native/ArgusTerminal electron/src/nativeTerminal
git commit -m "$(cat <<'EOF'
fix(native-term): keep 5000 lines of history, as xterm tiles do

SwiftTerm's default of 500 lines truncated the replay seed. The depth now
comes from one constant per side, kept in sync by check:deps.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Font size and page zoom (F3, F12)

**Files:**
- Modify: `OverlayController.swift`, `ShimTests.swift`, `native/addon/src/addon.mm`, `electron/src/nativeTerminal/types.ts`, `NativeTerminalHost.ts`, `NativeTerminalHost.test.ts`, `electron/src/main.ts` (attach handler ~line 805, zoom menu items ~line 668–670, new IPC), `electron/src/preload.ts`, `client/src/hooks/useNativeOverlayRect.ts` (+ test), `client/src/app/ui/TerminalShell.tsx`, `client/src/app/ui/TerminalShell.native.test.tsx`

**Interfaces:**
- Consumes: Task 3's `create(parentHandle, scrollback)`.
- Produces: Swift `@objc public func setFontSize(_ size: CGFloat)`; addon `setFontSize(id: number, size: number): void`; host `setFontSize(sessionId: string, px: number, parentHandle?: Buffer): void`, `setZoom(parentHandle: Buffer, factor: number): void`, `attach(sessionId, parentHandle, rect, fontSize?: number)`; preload `attach(sessionId, rect, fontSize?)`, `setFontSize(sessionId, px)`; hook `useNativeOverlayRect(sessionId, enabled, onFailure?, onAttached?, fontSize?)`.

- [ ] **Step 1: Confirm F12 live before coding the scaling**

Run `npm run dev`, open a native session in Focus, press ⌘+ three times. Expected (bug): the overlay no longer covers the tile's hole exactly (smaller, shifted toward top-left). Note the result in the task report; the scaling below is what fixes it. If the overlay still fits exactly, stop and report — the rect scaling must then be dropped from this task (keep the font-size part).

- [ ] **Step 2: Write the failing Swift test**

```swift
  /// The font must follow Argus's code font size; SwiftTerm's default is 13pt
  /// regardless of the setting. A bigger font means fewer columns.
  func testFontSizeChangesTheGrid() {
    let c = OverlayController(width: 800, height: 480)
    c.setFrame(x: 0, y: 0, width: 800, height: 480)
    let colsAt13 = c.gridCols
    c.setFontSize(26)
    XCTAssertLessThan(c.gridCols, colsAt13)
  }
```

- [ ] **Step 3: Write the failing host tests**

In `fakeAddon()` add to the addon object:

```ts
    setFontSize: (id, size) => calls.push(`setFontSize:${id}:${size}`),
```

Append:

```ts
test('attach applies the font size before seeding, so the seed matches the final grid', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT, 15);
  const font = calls.indexOf('setFontSize:1:15');
  const seed = calls.indexOf('gridSize:1');
  assert.ok(font >= 0 && font < seed, calls.join(','));
});

test('setFontSize applies to an attached overlay and ignores nonsense', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  calls.length = 0;
  host.setFontSize('s1', 16);
  host.setFontSize('s1', 0);
  host.setFontSize('s1', Number.NaN);
  assert.deepEqual(calls, ['setFontSize:1:16']);
});

test('zoom scales frames and font from CSS px to points', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT, 10);
  calls.length = 0;
  host.setZoom(HANDLE, 1.5);
  assert.ok(calls.includes('setFontSize:1:15'), calls.join(','));
  assert.ok(calls.includes('setFrame:1:15,30,450,300'), calls.join(','));
});

test('attach after setZoom scales the first frame and font', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.setZoom(HANDLE, 2);
  host.attach('s1', HANDLE, RECT, 10);
  assert.ok(calls.includes('setFontSize:1:20'), calls.join(','));
  assert.ok(calls.includes('setFrame:1:20,40,600,400'), calls.join(','));
});

test('zoom on one window leaves overlays on another alone', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  const winA = Buffer.alloc(8, 1);
  const winB = Buffer.alloc(8, 2);
  host.attach('s1', winA, RECT, 10);
  calls.length = 0;
  host.setZoom(winB, 2);
  assert.equal(calls.length, 0, calls.join(','));
});
```

- [ ] **Step 4: Write the failing client tests**

`useNativeOverlayRect.test.tsx` — add a probe and a test inside the first `describe`:

```tsx
function ProbeWithFont({ fontSize }: { fontSize: number }) {
  const ref = useNativeOverlayRect('s1', true, undefined, undefined, fontSize);
  return <div ref={ref} data-testid="hole" />;
}
```

```tsx
  it('attach receives the font size, so the first seed is laid out at the right size', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<ProbeWithFont fontSize={15} />));
    expect(api.attach.mock.calls[0][2]).toBe(15);
    act(() => root.unmount());
  });

  it('a font size change does not re-attach the overlay', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    await act(async () => { root.render(<ProbeWithFont fontSize={13} />); });
    await act(async () => { root.render(<ProbeWithFont fontSize={16} />); });
    expect(api.attach).toHaveBeenCalledTimes(1);
    expect(api.detach).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
```

`TerminalShell.native.test.tsx` — add `setFontSize: vi.fn(),` to `api`, import `FontSettingsContext` from `'../../context/font-settings-context.js'`, and append:

```tsx
describe('TerminalShellNativeHole — code font size', () => {
  it('follows the code font size setting', async () => {
    const root = mount();
    const tile = (size: number) => (
      <FontSettingsContext.Provider value={{ uiFontSize: 14, codeFontSize: size }}>
        <TerminalShell session={session} socket={socket} theme="dark" useNative />
      </FontSettingsContext.Provider>
    );
    await act(async () => { root.render(tile(13)); });
    await act(async () => { root.render(tile(17)); });
    expect(api.setFontSize).toHaveBeenLastCalledWith('s1', 17);
    await act(async () => root.unmount());
  });
});
```

- [ ] **Step 5: Run to verify all fail**

Run: `swift test --package-path native/ArgusTerminal; npm run test:electron; npm test -w client`
Expected: Swift build error (`setFontSize`), electron TS errors (`setFontSize`/`setZoom`/attach arity), client assertions fail.

- [ ] **Step 6: Implement Swift + addon**

`OverlayController.swift`, next to `setScrollback`:

```swift
  /// Argus's code font size, in points (the host has already applied page
  /// zoom). SF Mono via the system monospace font — what xterm's
  /// `"SF Mono", ui-monospace` resolves to. Changing it recomputes the grid,
  /// and sizeChanged reports the new cols/rows like any resize.
  @objc public func setFontSize(_ size: CGFloat) {
    guard size > 0 else { return }
    terminalView.font = NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
  }
```

`addon.mm`:

```objc
Napi::Value SetFontSize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "setFontSize(id, size) requires a numeric size").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  OverlayController* c = Lookup(info, nullptr);
  if (c) [c setFontSize:info[1].As<Napi::Number>().DoubleValue()];
  return env.Undefined();
}
```

and `exports.Set("setFontSize", Napi::Function::New(env, SetFontSize));`.

- [ ] **Step 7: Implement the host**

`types.ts` addon interface: `setFontSize(id: number, size: number): void;`

`NativeTerminalHost.ts`:

(a) Fields, after `pendingResize`:

```ts
  // Page zoom per parent window, and the code font size per session — both in
  // the renderer's CSS px. Everything the renderer measures is CSS px, but the
  // overlay lives in AppKit points; at any zoom other than 1 they differ, so
  // every frame and font reaches the addon scaled (pushFrame/pushFontSize).
  private readonly zoomByParent = new Map<string, number>();
  private readonly fontSizeBySession = new Map<string, number>();
```

(b) Helpers, before `seed()`:

```ts
  private zoomFor(sessionId: string): number {
    const key = this.parentBySession.get(sessionId);
    return (key !== undefined && this.zoomByParent.get(key)) || 1;
  }

  /** The single path from a CSS-px rect to the addon: scaled, guarded. */
  private pushFrame(sessionId: string, id: number, rect: Rect): void {
    const z = this.zoomFor(sessionId);
    try {
      this.addon!.setFrame(id, rect.x * z, rect.y * z, rect.width * z, rect.height * z);
    } catch (err) {
      console.error('[native-term] setFrame failed for', sessionId, err);
    }
  }

  private pushFontSize(sessionId: string, id: number): void {
    const px = this.fontSizeBySession.get(sessionId);
    if (px === undefined) return;
    try {
      this.addon!.setFontSize(id, px * this.zoomFor(sessionId));
    } catch (err) {
      console.error('[native-term] setFontSize failed for', sessionId, err);
    }
  }
```

(c) Replace every direct `this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height)` try/catch block (in `attach`'s re-attach branch, `setRect`, `applyVisibility`, `resyncParent`) with `this.pushFrame(sessionId, id, rect);` — `grep -n "addon.setFrame\|addon!.setFrame" electron/src/nativeTerminal/NativeTerminalHost.ts` must afterwards show only the line inside `pushFrame`.

(d) `attach` signature and font application — change the signature to `attach(sessionId: string, parentHandle: Buffer, rect: Rect, fontSize?: number): boolean`, and right after `this.parentBySession.set(sessionId, parentHandle.toString('base64'));` in the create branch add:

```ts
      // Before the first frame/seed: the seed is laid out for the grid this
      // font produces, so applying it later would reflow the seed.
      if (fontSize !== undefined && fontSize > 0) {
        this.fontSizeBySession.set(sessionId, fontSize);
        this.pushFontSize(sessionId, id);
      }
```

(e) Public methods, after `setResizeSuspended`:

```ts
  /** Argus's code font size for this overlay, in CSS px. */
  setFontSize(sessionId: string, px: number, parentHandle?: Buffer): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    if (!this.isCurrentParent(sessionId, parentHandle)) return;
    if (!Number.isFinite(px) || px <= 0) return;
    this.fontSizeBySession.set(sessionId, px);
    this.pushFontSize(sessionId, id);
  }

  /**
   * The page zoom of one parent window changed (or is being reported before
   * an attach). Re-applies font and frame for every overlay on that window —
   * the renderer's rects do not necessarily change with zoom, so nothing else
   * would re-push them.
   */
  setZoom(parentHandle: Buffer, factor: number): void {
    if (!this.addon || !Number.isFinite(factor) || factor <= 0) return;
    const key = parentHandle.toString('base64');
    if (this.zoomByParent.get(key) === factor) return;
    this.zoomByParent.set(key, factor);
    for (const [sessionId, k] of this.parentBySession) {
      if (k !== key) continue;
      const id = this.bySession.get(sessionId);
      if (id === undefined) continue;
      this.pushFontSize(sessionId, id);
      const rect = this.rectBySession.get(sessionId);
      if (rect && this.shown.has(sessionId)) this.pushFrame(sessionId, id, rect);
    }
  }
```

(f) `detach`: add `this.fontSizeBySession.delete(sessionId);` with the other deletes.

- [ ] **Step 8: Implement main + preload**

`main.ts`:

- `native-term:attach` handler: accept `fontSize` and report zoom first:

```ts
  ipcMain.handle('native-term:attach', (e, { sessionId, rect, fontSize }: { sessionId: string; rect: { x: number; y: number; width: number; height: number }; fontSize?: number }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    const handle = win.getNativeWindowHandle();
    // Zoom is restored per window on load (window.ts), so it can already be
    // non-1 here; the host needs it before the first frame.
    nativeTerminal!.setZoom(handle, win.webContents.getZoomFactor());
    const ok = nativeTerminal!.attach(sessionId, handle, rect, fontSize);
    if (ok) trackNativeTermAttach(sessionId, win);
    return ok;
  });
```

- New IPC next to `native-term:set-dimmed`:

```ts
  ipcMain.on('native-term:set-font-size', (e, { sessionId, px }: { sessionId: string; px: number }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    nativeTerminal!.setFontSize(sessionId, px, win?.getNativeWindowHandle());
  });
```

- Zoom helper (top level, near `applyMenuAcceleratorGating`):

```ts
/** Zooms the focused window and tells its native overlays, whose frames and
 *  fonts are scaled by the zoom factor (see NativeTerminalHost.setZoom). */
function setZoomLevelAndSyncNative(level: number): void {
  setZoomLevelForFocused(level);
  const win = getAppWindow(getFocusedWindowId()) ?? getMainWindow();
  if (win && !win.isDestroyed()) {
    nativeTerminal?.setZoom(win.getNativeWindowHandle(), win.webContents.getZoomFactor());
  }
}
```

and replace the three `setZoomLevelForFocused(...)` calls in the View menu (`Actual Size`, `Zoom In`, `Zoom Out`) with `setZoomLevelAndSyncNative(...)`. Verify `setZoomLevelForFocused` resolves the window the same way (`electron/src/window.ts:313`); if it uses a different lookup, use that same lookup in the helper.

`preload.ts`:

```ts
  attach: (sessionId: string, rect: NativeTerminalRect, fontSize?: number): Promise<boolean> =>
    ipcRenderer.invoke('native-term:attach', { sessionId, rect, fontSize }),
```

and after `setResizeSuspended`:

```ts
  setFontSize: (sessionId: string, px: number): void => {
    ipcRenderer.send('native-term:set-font-size', { sessionId, px });
  },
```

- [ ] **Step 9: Implement the client**

`useNativeOverlayRect.ts`:
- bridge type: `attach: (sessionId: string, rect: NativeOverlayRect, fontSize?: number) => Promise<boolean>;`
- signature: add a fifth parameter `fontSize?: number`;
- mirror it into a ref (same pattern as `onAttachedRef`) so a change does not re-run the effect:

```ts
  // Read at attach time only; later changes go through setFontSize (see
  // TerminalShellNativeHole), not a re-attach.
  const fontSizeRef = useRef(fontSize);
  useEffect(() => {
    fontSizeRef.current = fontSize;
  });
```

- `void api.attach(sessionId, initialRect).then(` → `void api.attach(sessionId, initialRect, fontSizeRef.current).then(`

`TerminalShell.tsx` (`TerminalShellNativeHole`):
- `import { useFontSettings } from '../../context/font-settings-context.js';`
- `const { codeFontSize } = useFontSettings();`
- pass it as the hook's fifth argument: `useNativeOverlayRect(session.id, !failed, () => setFailed(true), () => setAttachGeneration((n) => n + 1), codeFontSize);`
- add the bridge type and effect next to the dim effect:

```tsx
/** The slice of the native-terminal preload bridge that sets the overlay's
 *  code font size (CSS px; main applies page zoom). */
interface NativeFontBridge {
  setFontSize?(sessionId: string, px: number): void;
}
```

```tsx
  // Code font size — the xterm path reads the same setting (useTerminal's
  // codeFontSize). Attach already carries the size; this covers changes.
  useEffect(() => {
    (window as Window & { electronNativeTerminal?: NativeFontBridge })
      .electronNativeTerminal?.setFontSize?.(session.id, codeFontSize);
  }, [session.id, codeFontSize, attachGeneration]);
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `swift test --package-path native/ArgusTerminal && npm run build:native -- --arch=arm64 && npm run verify`
Expected: all PASS.

- [ ] **Step 11: Manual check**

`npm run dev`: change Settings → Typography code font size with a native tile open → text size changes and the agent reflows once. Press ⌘+ / ⌘− / ⌘0 → overlay stays exactly on the hole and text scales like neighbouring xterm tiles.

- [ ] **Step 12: Commit**

```bash
git add native electron/src client/src
git commit -m "$(cat <<'EOF'
fix(native-term): follow the code font size and page zoom

Native tiles used SwiftTerm's fixed 13pt font and placed the overlay in CSS
px, so the font setting did nothing and any page zoom other than 100%
mis-sized the overlay. The host now keeps geometry and font in CSS px and
scales both by the window's zoom factor at the addon boundary; attach
carries the font size so the first seed is laid out at the final grid.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: A departing phone restores the native size (F5)

**Files:**
- Modify: `server/src/services/SessionManager.ts` (`scheduleIdleGeometry`, `setNativeViewer`, new `resizeFromNative`), `electron/src/main.ts` (host deps `resizeSession`)
- Test: `server/src/services/SessionManager.geometry.test.ts`

**Interfaces:**
- Produces: `SessionManager.resizeFromNative(id: string, cols: number, rows: number): void`.

- [ ] **Step 1: Write the failing tests**

Append to `SessionManager.geometry.test.ts`:

```ts
// The phone is sized in (smallest mobile viewer wins), but on leaving there are
// no socket dimensions left — and the native view, whose size never changed,
// never reports again. The server has to remember what native asked for.
test('the last socket leaving a natively viewed session restores the native size', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const calls = withSizedSession(sm, 'sess-phone', 120, 40);
  sm.setNativeViewer('sess-phone', true);
  sm.resizeFromNative('sess-phone', 120, 40);
  sm.resizeSession('sess-phone', 50, 30);   // phone joined
  calls.pty.length = 0;

  sm.scheduleIdleGeometry('sess-phone');    // phone left, no socket dims

  assert.deepEqual(calls.pty, [{ cols: 120, rows: 40 }]);
  clearTimeout((sm as any).sessions.get('sess-phone').trimTimer);
});

test('the restored size is the latest one native reported', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const calls = withSizedSession(sm, 'sess-phone-2', 120, 40);
  sm.setNativeViewer('sess-phone-2', true);
  sm.resizeFromNative('sess-phone-2', 120, 40);
  sm.resizeSession('sess-phone-2', 50, 30);   // phone joined
  sm.resizeFromNative('sess-phone-2', 140, 44); // user resized the tile meanwhile
  sm.resizeSession('sess-phone-2', 50, 30);   // phone re-asserts
  calls.pty.length = 0;

  sm.scheduleIdleGeometry('sess-phone-2');

  assert.deepEqual(calls.pty, [{ cols: 140, rows: 44 }]);
  clearTimeout((sm as any).sessions.get('sess-phone-2').trimTimer);
});

test('once the native viewer is gone its size is forgotten', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  withSizedSession(sm, 'sess-gone', 120, 14);
  (sm as any).io = { sockets: { adapter: { rooms: new Map() } } };
  const gate = (sm as any).idleGeometry;
  const scheduled: string[] = [];
  gate.schedule = (id: string) => scheduled.push(id);
  gate.cancel = () => {};
  sm.setNativeViewer('sess-gone', true);
  sm.resizeFromNative('sess-gone', 120, 14);
  sm.setNativeViewer('sess-gone', false);   // arms the idle resize (empty room)

  assert.deepEqual(scheduled, ['sess-gone']);
  assert.equal((sm as any).nativeSize.has('sess-gone'), false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w server`
Expected: FAIL — `sm.resizeFromNative is not a function`.

- [ ] **Step 3: Implement**

`SessionManager.ts` — field next to `nativeViewers`:

```ts
  /** The size each native viewer last asked for — restored when a socket
   *  viewer (a phone) that overrode it leaves; see scheduleIdleGeometry. */
  private nativeSize = new Map<string, { cols: number; rows: number }>();
```

method next to `setNativeViewer`:

```ts
  /**
   * A native overlay's resize. Recorded as well as applied: a phone can size
   * the pty down while it watches, and when it leaves the native view — whose
   * own size never changed — has no reason to report again.
   */
  resizeFromNative(id: string, cols: number, rows: number): void {
    this.nativeSize.set(id, { cols, rows });
    this.resizeSession(id, cols, rows);
  }
```

`scheduleIdleGeometry` becomes:

```ts
  scheduleIdleGeometry(id: string): void {
    // The room emptied, but a native overlay may still be watching. Give the
    // pty back the size it asked for (a departing phone may have shrunk it)
    // rather than the idle geometry.
    const native = this.nativeSize.get(id);
    if (native) {
      this.resizeSession(id, native.cols, native.rows);
      return;
    }
    if (this.nativeViewers.has(id)) return;
    this.idleGeometry.schedule(id);
  }
```

In `setNativeViewer`, in the stopping branch, add `this.nativeSize.delete(id);` immediately after `if (!this.nativeViewers.delete(id)) return;`.

`main.ts` host deps: `resizeSession: (id: string, c: number, r: number) => sm.resizeFromNative(id, c, r),`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w server && npm run test:electron`
Expected: PASS (both callers of `scheduleIdleGeometry` in `handler.ts` already wrap it in try/catch).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/SessionManager.ts server/src/services/SessionManager.geometry.test.ts electron/src/main.ts
git commit -m "$(cat <<'EOF'
fix(native-term): give the pty back its native size when a phone viewer leaves

A phone sizes a session to its own width while it watches. When it left, no
socket dimensions remained and the native view never re-reported, so the
session stayed phone-width under a desktop-sized SwiftTerm grid.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Parent moves re-derive the overlay frame instead of snapping back (F8)

**Files:**
- Modify: `OverlayController.swift` (`setFrame`, `restoreAppliedFrameIfMovedExternally`)
- Test: `ShimTests.swift`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

```swift
  /// When the parent moves, AppKit carries the child along and posts didMove.
  /// Restoring the last applied SCREEN frame then snaps the overlay back to
  /// where the parent used to be; the frame must be re-derived from the
  /// viewport rect against the parent's new position.
  func testAParentMoveReDerivesTheFrameRatherThanSnappingBack() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 800, height: 600),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.show()
    c.setFrame(x: 10, y: 20, width: 300, height: 150)

    parent.setFrameOrigin(NSPoint(x: 400, y: 300))
    // What AppKit's child-follow would do, then the didMove-driven restore.
    c.debugSimulateExternalMove(to: c.debugFrame().offsetBy(dx: 300, dy: 200))

    let content = parent.contentRect(forFrameRect: parent.frame)
    XCTAssertEqual(c.debugFrame().origin.x, content.minX + 10, accuracy: 0.5)
    XCTAssertEqual(c.debugFrame().origin.y, content.maxY - 20 - 150, accuracy: 0.5)
  }
```

- [ ] **Step 2: Run to verify it fails**

Run: `swift test --package-path native/ArgusTerminal --filter ShimTests/testAParentMove`
Expected: FAIL — x is the old `100 + 10`-based value.

- [ ] **Step 3: Implement**

Fields in `OverlayController`, next to `frameObservers`:

```swift
  /// The viewport rect setFrame last converted, and the parent content rect it
  /// was converted against. If the parent has moved since, a frame change on
  /// this window is AppKit carrying the child along, not an external mover.
  private var lastViewport: NSRect?
  private var lastParentContent: NSRect?
```

In `setFrame`, right after `let parentContent = parent.contentRect(forFrameRect: parent.frame)`:

```swift
    lastViewport = NSRect(x: x, y: y, width: w, height: h)
    lastParentContent = parentContent
```

Replace `restoreAppliedFrameIfMovedExternally` with:

```swift
  private func restoreAppliedFrameIfMovedExternally() {
    guard let w = window as? KeyableWindow, !w.applyingFrame else { return }
    // The parent moved (drag, window manager, display change): re-derive from
    // the viewport rect against where the parent is NOW. Restoring the old
    // screen frame would fight AppKit's child-follow until resyncParent lands.
    if let vp = lastViewport, let parent = w.parent ?? parentWindow,
       parent.contentRect(forFrameRect: parent.frame) != lastParentContent {
      setFrame(x: vp.minX, y: vp.minY, width: vp.width, height: vp.height)
      return
    }
    guard let want = w.appliedFrame, w.frame != want else { return }
    otrace("external frame change on #\(w.windowNumber): \(w.frame) -> restoring \(want)")
    w.applyingFrame = true
    w.setFrame(want, display: true)
    w.applyingFrame = false
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path native/ArgusTerminal`
Expected: all PASS, including the existing external-move restore test.

- [ ] **Step 5: Manual check**

`npm run dev` with `ARGUS_NATIVE_TERM_DEBUG=1`: drag the Argus window quickly with a native tile visible → no overlay lag/jitter; the `external frame change … restoring` trace line appears only for real external moves (Rectangle/Spectacle on the overlay).

- [ ] **Step 6: Commit**

```bash
git add native/ArgusTerminal
git commit -m "$(cat <<'EOF'
fix(native-term): re-derive the overlay frame when its parent moves

AppKit carries a child window along with its parent and posts didMove; the
external-move guard then snapped the overlay back to a frame computed against
the parent's old position until resyncParent caught up.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: VoiceOver can read native tiles without window managers targeting them (F9) — spike

This is timeboxed (1–2 h). Window managers act on the app's AX *windows*; VoiceOver reads the AX element tree. The spike tries to present the overlay as a **group inside the Argus window** rather than a window of its own. If any acceptance check fails, revert to the current opt-out and record F9 as a known limitation in `docs/solutions/`.

**Files:**
- Modify: `OverlayController.swift` (`KeyableWindow` AX overrides, `attach(to:)`)
- Test: `ShimTests.swift` (existing `testTheOverlayIsInvisibleToTheAccessibilityAPI` is replaced)

- [ ] **Step 1: Replace the AX test with the target behaviour**

Replace `testTheOverlayIsInvisibleToTheAccessibilityAPI` with:

```swift
  /// Not a window to the AX API (window managers act on AXWindow elements),
  /// but a group whose parent is the Argus window's content — so VoiceOver
  /// reaches SwiftTerm's own accessibility support through the Argus window.
  func testTheOverlayIsAGroupInsideItsParentNotAWindow() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    XCTAssertEqual(c.debugAccessibilityRole(), .group)
    XCTAssertTrue(c.debugIsAccessibilityElement())
    XCTAssertTrue(c.debugAccessibilityParent() as AnyObject? === parent.contentView)
  }
```

Add seam: `public func debugAccessibilityParent() -> Any? { window?.accessibilityParent() }`

- [ ] **Step 2: Run to verify it fails**

Run: `swift test --package-path native/ArgusTerminal --filter ShimTests/testTheOverlayIsAGroup`
Expected: FAIL (role is nil, not an element).

- [ ] **Step 3: Implement**

In `KeyableWindow`, replace the two AX overrides with:

```swift
  /// Presented to the AX API as a GROUP inside the Argus window, not a window.
  /// Window managers (Spectacle, Rectangle, macOS window commands) act on the
  /// app's AXWindow elements — as a window, this overlay was what "center
  /// window" centered. As a group whose parent is the Argus content view,
  /// VoiceOver still reaches the terminal through the Argus window.
  weak var accessibilityHost: NSView?
  override func accessibilityRole() -> NSAccessibility.Role? { .group }
  override func isAccessibilityElement() -> Bool { true }
  override func accessibilityParent() -> Any? { accessibilityHost }
```

In `attach(to:)` after `parentWindow = parent`: `w.accessibilityHost = parent.contentView`; in `reparent(to:)` after `parentWindow = parent`: `(window as? KeyableWindow)?.accessibilityHost = parent.contentView`.

- [ ] **Step 4: Run tests**

Run: `swift test --package-path native/ArgusTerminal`
Expected: PASS.

- [ ] **Step 5: Acceptance (manual, all three must hold)**

`npm run build:native -- --arch=arm64 && npm run dev`, native tile focused:
1. Accessibility Inspector: the overlay appears as `AXGroup` under the Argus window, not as a top-level `AXWindow` of the app.
2. Rectangle/Spectacle "center window" with the native tile focused moves the **Argus** window, not the overlay.
3. VoiceOver (⌘F5) reads the terminal's visible text.

If 1 or 2 fails: `git checkout -- native/` to revert, then create `docs/solutions/native-terminal/voiceover-overlay-limitation.md` with YAML frontmatter (`module: native-terminal`, `tags: [accessibility, voiceover, child-window]`, `problem_type: known-limitation`) describing the window-manager conflict and what was tried, and commit only that doc.

- [ ] **Step 6: Commit (success path)**

```bash
git add native/ArgusTerminal
git commit -m "$(cat <<'EOF'
feat(native-term): expose native tiles to VoiceOver as a group in the Argus window

The overlay opted out of accessibility entirely so window managers would stop
targeting it, which also hid the terminal from VoiceOver. As an AXGroup
parented to the Argus content view it is no longer an AXWindow, so window
managers skip it, while VoiceOver reaches SwiftTerm's text.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: CI builds the addon and runs the Swift tests (F6)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the job**

Append under `jobs:` (sibling of `daemon:`):

```yaml
  native:
    # Native terminal engine: SwiftTerm shim (SwiftPM) + N-API addon. Before
    # this, a Swift or ObjC++ break surfaced only in release packaging, and the
    # shim's XCTest suite never ran at all.
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'

      - name: Cache SwiftPM
        uses: actions/cache@v4
        with:
          path: native/ArgusTerminal/.build
          key: spm-${{ runner.os }}-${{ hashFiles('native/ArgusTerminal/Package.resolved') }}

      - name: Install dependencies
        run: npm ci

      - name: Swift tests
        run: swift test --package-path native/ArgusTerminal

      # Host arch only (arm64 on macos-15): proves the addon compiles and links
      # against the shim. Packaging still builds both arches.
      - name: Build addon
        run: npm run build:native -- --arch=arm64

      - name: Addon loads and exports its surface
        run: >
          node -e "const a=require('./electron/resources/native-terminal/arm64/argus_native_terminal.node');
          for (const k of ['create','setFrame','feed','gridSize','setFontSize','destroy'])
          if (typeof a[k] !== 'function') { console.error('missing export', k); process.exit(1); }"
```

- [ ] **Step 2: Validate locally**

Run: `swift test --package-path native/ArgusTerminal && npm run build:native -- --arch=arm64 && node -e "const a=require('./electron/resources/native-terminal/arm64/argus_native_terminal.node'); for (const k of ['create','setFrame','feed','gridSize','setFontSize','destroy']) if (typeof a[k] !== 'function') { console.error('missing export', k); process.exit(1); }"`
Expected: exit 0. (Loading the addon in plain Node works because it only dlopens AppKit; no window is created.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: build the native terminal addon and run the Swift shim tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] `export PATH=~/.nvm/versions/node/v24.16.0/bin:$PATH && npm run verify`
- [ ] `swift test --package-path native/ArgusTerminal`
- [ ] `npm run build:native -- --arch=arm64`
- [ ] Manual, in `npm run dev` with a native tile beside an xterm tile:
  - [ ] plain drag selects; ⌘C copies; wheel scrolls back ≥ 1000 lines
  - [ ] Italian/German layout: `@` `#` `[` `]` type correctly
  - [ ] Typography code font size changes the native tile; ⌘+/⌘−/⌘0 keep the overlay on its hole
  - [ ] connect the phone companion to that session, disconnect → native tile's text wraps at its own width again
  - [ ] drag the window quickly → overlay does not lag or snap
