# Native Terminal Behaviour Parity (round 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give native (SwiftTerm) tiles the behaviour layer xterm.js tiles get from `useTerminal.ts` — Option special keys, copy reflow, refresh frames that respect a reader scrolled up, re-alignment after resizes and settles, wheel speed, and Option+click cursor moves.

**Architecture:** "Native" replaced the renderer, not Argus's behaviour layer: xterm tiles get key translation, copy reflow, a replay policy and resync requests from JavaScript in `client/src/hooks/useTerminal.ts`, `terminalCopy.ts`, `replayPolicy.ts` and `terminalMouse.ts`. Each task ports one of those behaviours: keyboard/mouse/scroll ones into the Swift shim (`KeyableWindow.sendEvent` / `OverlayController`), policy ones into `NativeTerminalHost` (TypeScript, testable without a native build), and the copy formatter stays in the renderer so it exists once.

**Tech Stack:** Swift 5.9 + SwiftTerm 1.20.0, ObjC++ N-API addon, Electron main (TypeScript, node:test), React renderer (Vitest), server (node:test).

**Spec:** The "Findings" section below (behaviour audit of 2026-09-26, comparing every xterm-path handler with the native path; xterm.js sources quoted from `node_modules/@xterm/xterm/src`).

## Findings (the spec)

| # | Behaviour | xterm path (reference) | Native before this plan | Decision |
|---|---|---|---|---|
| B1 | Option+⌫, Option+fn⌫, Option+←/→/↑/↓ | `Keyboard.ts`: ⌫+alt → `ESC DEL`; ←/→ with alt on macOS → `ESC b` / `ESC f`; ↑/↓ with alt → `ESC [1;3A` / `ESC [1;3B`; forward delete with alt → `ESC [3;3~`. Applies whatever `macOptionIsMeta` is. | Dropped: with `optionAsMetaKey = false` (needed for `@ # [ ]` on non-US layouts) SwiftTerm routes Option+special keys through `interpretKeyEvents`, and its `doCommand` has no case for `deleteWordBackward:` / `moveWordLeft:` etc. | Translate in `KeyableWindow.sendEvent`, like Shift+Enter; Option+printable keys keep typing characters. |
| B2 | Copy | `useTerminal.ts` `copy` listener → `terminalSelectionToClipboard(getSelection())` (`client/src/hooks/terminalCopy.ts`): dedent the agent's gutter, rejoin rows the agent wrapped. | SwiftTerm's `copy:` puts raw rows on the pasteboard: a newline per visual row plus the gutter. | Override `copy:` in the shim; main writes the raw text immediately (so ⌘C never silently fails) and asks the owning renderer to format it with the same `terminalSelectionToClipboard`, then overwrites the clipboard with the formatted text. |
| B3 | Unsolicited refresh frame while the reader is scrolled up | `replayPolicy.ts` `shouldPaintReplay('refresh', scrolledUp)` → skipped. | Fed unconditionally: the frame's `ESC[3J` + reprint throws away the reader's position and history view. | Host skips refresh frames while the overlay is scrolled up, remembers one is owed, and re-seeds when the reader returns to the bottom. |
| B4 | Re-alignment | `useTerminal.ts`: after a grid change `resync(120)`; after status `running → waiting/done` `resync(150, 300)`; the server answers with a screen-only frame (`getReplaySnapshot(id, 'screen')`, no `ESC[3J`). | Never re-aligns: SwiftTerm's reflow plus the agent's repaint can leave a drifted screen. | Host feeds a screen-only frame 120 ms after a forwarded native resize and 450 ms after `running → waiting/done`. |
| B5 | Wheel speed | `scrollSensitivity: 3`, `fastScrollSensitivity: 10` with Option (xterm's default `fastScrollModifier: 'alt'`). | SwiftTerm `scrollSensitivity = 1`, no fast mode. | Sensitivity 3, and 10 while Option is held. |
| B6 | Option+click moves the cursor | `altClickMovesCursor: true`: on mouse-up, selection ≤ 1 char, < 500 ms, not scrolled up → `moveToCellSequence` (normal buffer: horizontal arrow keys only, counting cells across rows). | Not supported. | Port the normal-buffer algorithm into the shim. |
| B7 | Scroll to bottom on typing | `scrollOnUserInput: true` — unconditional, on every user keystroke. | SwiftTerm `send(data:)` already calls `ensureCaretIsVisible()`, but that scroll is **conditional**: it only fires when the caret has actually left the viewport, so a reader scrolled up just a little (caret still technically visible) is left stranded — a defect in this plan's original read of B7, found in final review round 2. | Route Shift+Enter (and B1's keys) through `terminalView.send(data:)`, **and** have `KeyableWindow.sendEvent` scroll a scrolled-up reader to the bottom **unconditionally** on every user keyDown (terminal focused, Command not held), independent of SwiftTerm's own caret check. |
| B8 | Double-click word boundaries | `wordSeparator: ' ()[]{}\',"`'` | SwiftTerm's own rule; not configurable in SwiftTerm 1.20 (no separator API in `SelectionService.swift`). | Accepted difference — no code. |

## Global Constraints

- Node for all npm/test commands: `export PATH=~/.nvm/versions/node/v24.16.0/bin:$PATH` (`.nvmrc` = 24).
- Server and `electron/` code may only `import type` from `@argus/shared` or renderer code; the copy formatter therefore runs in the renderer.
- Every host→addon call stays in try/catch (degrade, never throw). The addon is compiled with `NAPI_DISABLE_CPP_EXCEPTIONS`: type-check every argument before `.As<>()`.
- SwiftTerm `keyDown`/`scrollWheel`/`mouseDown` are `public`, not `open` — never override them; intercept in `KeyableWindow.sendEvent`. `copy(_:)` IS `open` and may be overridden.
- Tests assert outcomes (bytes sent, clipboard text, frames fed), not flag values.
- Pre-commit gate: `npm run verify`; native gate: `swift test --package-path native/ArgusTerminal` and `npm run build:native -- --arch=arm64`.
- Commit messages: conventional commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Option+letter on an Italian layout still types the character** (B1 must intercept only the six special keys). Test in Task 1 (`optionLetterIsNotIntercepted`).
2. **IME composing when an Option special key is pressed** — the composition owns the key, as with Shift+Enter. Test in Task 1.
3. **A refresh frame arrives while scrolled up, then live output keeps streaming, then the reader returns** — exactly one re-seed on return, none before. Test in Task 3.
4. **A realign timer fires after the overlay was hidden or detached** — nothing is fed. Test in Task 4.
5. **Copy when no renderer handles the formatting request** (window reloading) — the raw text is still on the clipboard. main.ts has no unit tests, so Task 2 pins it by construction (`clipboard.writeText(text)` precedes the IPC send in `notifyCopy`) and the final live check copies once with DevTools-reloading the window.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift` | Modify | Option-key translation, Shift+Enter via `send`, copy override hook, scrolled-up reporting, wheel sensitivity, Option+click |
| `native/ArgusTerminal/Sources/ArgusTerminal/MoveToCell.swift` | Create | Pure port of xterm's normal-buffer `moveToCellSequence` |
| `native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift` | Modify | Swift tests |
| `native/addon/src/addon.mm` | Modify | `onCopy`, `onScrolledUp` callbacks |
| `electron/src/nativeTerminal/types.ts` | Modify | addon + deps surface |
| `electron/src/nativeTerminal/NativeTerminalHost.ts` (+ test) | Modify | copy forwarding, refresh-while-scrolled-up policy, realign timers |
| `electron/src/main.ts`, `electron/src/preload.ts` | Modify | clipboard write, copy IPC, status/snapshot wiring |
| `client/src/app/ui/TerminalShell.tsx` (+ `TerminalShell.native.test.tsx`) | Modify | format copy requests with `terminalSelectionToClipboard` |
| `server/src/services/SessionManager.ts` (+ a test) | Modify | `onStatus` subscription via one `emitStatus` helper |

---

### Task 1: Option special keys, Shift+Enter via send (B1, B7)

**Files:**
- Modify: `native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift` (`KeyableWindow` and `attach(to:)`)
- Test: `native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift`

**Interfaces:**
- Produces: `static func optionKeySequence(_ event: NSEvent) -> [UInt8]?` on `KeyableWindow`; `var onOptionKey: (([UInt8]) -> Void)?` on `KeyableWindow`.

- [ ] **Step 1: Write the failing tests**

Append inside `ShimTests` (the existing `debugSendKey(keyCode:flags:)` seam builds a real keyDown and runs it through `sendEvent`; translation is keyed on `keyCode`, so its fixed `characters` do not matter):

```swift
  private func attachedController() -> (OverlayController, NSWindow) {
    let c = OverlayController(width: 400, height: 240)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.show()
    return (c, parent)
  }

  /// xterm.js sends these for Option+special keys whatever macOptionIsMeta is
  /// (Keyboard.ts). With Option no longer Meta, SwiftTerm dropped them.
  func testOptionSpecialKeysSendXtermSequences() {
    let cases: [(UInt16, [UInt8])] = [
      (51, [0x1b, 0x7f]),                                   // ⌫  → ESC DEL
      (117, Array("\u{1b}[3;3~".utf8)),                     // fn⌫ → ESC [3;3~
      (123, Array("\u{1b}b".utf8)),                         // ←  → ESC b
      (124, Array("\u{1b}f".utf8)),                         // →  → ESC f
      (126, Array("\u{1b}[1;3A".utf8)),                     // ↑
      (125, Array("\u{1b}[1;3B".utf8)),                     // ↓
    ]
    for (code, want) in cases {
      let (c, parent) = attachedController()
      _ = parent
      var sent: [Data] = []
      c.onInput = { sent.append($0 as Data) }
      // Arrow keys carry .function and .numericPad; the translation must ignore them.
      let flags: NSEvent.ModifierFlags = [123, 124, 125, 126].contains(code)
        ? [.option, .function, .numericPad] : [.option]
      c.debugSendKey(keyCode: code, flags: flags)
      XCTAssertEqual(sent, [Data(want)], "keyCode \(code)")
    }
  }

  /// Review Focus 1: Option+letter must still type what the layout puts there
  /// (Italian ⌥ò = @). Only the six special keys are translated.
  func testOptionLetterIsNotIntercepted() {
    let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [.option],
                             timestamp: 0, windowNumber: 0, context: nil,
                             characters: "@", charactersIgnoringModifiers: "ò",
                             isARepeat: false, keyCode: 41)!
    XCTAssertNil(KeyableWindow.optionKeySequence(e))
  }

  func testOptionWithCommandOrControlIsNotIntercepted() {
    for extra: NSEvent.ModifierFlags in [.command, .control, .shift] {
      let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [.option, extra],
                               timestamp: 0, windowNumber: 0, context: nil,
                               characters: "", charactersIgnoringModifiers: "",
                               isARepeat: false, keyCode: 51)!
      XCTAssertNil(KeyableWindow.optionKeySequence(e), "\(extra)")
    }
  }

  /// Review Focus 2: the IME owns keys while composing.
  func testOptionSpecialKeyDuringCompositionIsLeftToTheInputMethod() {
    let (c, parent) = attachedController()
    _ = parent
    var sent: [Data] = []
    c.onInput = { sent.append($0 as Data) }
    c.debugSetMarkedText("にほ")
    c.debugSendKey(keyCode: 51, flags: .option)
    XCTAssertFalse(sent.contains(Data([0x1b, 0x7f])))
  }

  /// B7: typing scrolls a reader back to the bottom (xterm scrollOnUserInput).
  /// SwiftTerm does this inside send(data:); Argus's own translations must go
  /// through it too.
  func testTranslatedKeysScrollBackToTheBottom() {
    let (c, parent) = attachedController()
    _ = parent
    c.setFrame(x: 0, y: 0, width: 400, height: 240)
    c.feed(data: Data(String(repeating: "line\r\n", count: 200).utf8) as NSData)
    c.debugScrollToTop()
    XCTAssertTrue(c.debugIsScrolledUp())
    c.debugSendKey(keyCode: 36, flags: .shift)        // Shift+Enter
    XCTAssertFalse(c.debugIsScrolledUp())
    c.debugScrollToTop()
    c.debugSendKey(keyCode: 51, flags: .option)       // Option+⌫
    XCTAssertFalse(c.debugIsScrolledUp())
  }
```

- [ ] **Step 2: Run to verify they fail**

Run: `swift test --package-path native/ArgusTerminal`
Expected: build FAILS — `optionKeySequence`, `debugScrollToTop`, `debugIsScrolledUp` undefined.

- [ ] **Step 3: Implement**

In `KeyableWindow`, below `isComposingText`:

```swift
  /// Called instead of delivering an Option+special key to SwiftTerm, with the
  /// bytes xterm.js sends for it (see optionKeySequence).
  var onOptionKey: (([UInt8]) -> Void)?

  /// xterm.js's bytes for Option+⌫/fn⌫/←/→/↑/↓ (Keyboard.ts), or nil for any
  /// other key. With optionAsMetaKey off — required so Option+letter types the
  /// characters non-US layouts put there — SwiftTerm sends these keys through
  /// interpretKeyEvents, and its doCommand has no case for deleteWordBackward:
  /// or moveWordLeft:, so they were silently dropped. Exactly Option: Command,
  /// Control or Shift alongside it is another binding. Arrow keys also carry
  /// .function and .numericPad, which say nothing about the user's modifiers.
  static func optionKeySequence(_ event: NSEvent) -> [UInt8]? {
    let f = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
      .subtracting([.function, .numericPad, .capsLock])
    guard f == .option else { return nil }
    switch event.keyCode {
    case 51: return [0x1b, 0x7f]                        // ⌫
    case 117: return Array("\u{1b}[3;3~".utf8)           // forward delete
    case 123: return Array("\u{1b}b".utf8)               // ←
    case 124: return Array("\u{1b}f".utf8)               // →
    case 126: return Array("\u{1b}[1;3A".utf8)           // ↑
    case 125: return Array("\u{1b}[1;3B".utf8)           // ↓
    default: return nil
    }
  }
```

Replace the body of `sendEvent` with:

```swift
  override func sendEvent(_ event: NSEvent) {
    if event.type == .keyDown, !(isComposingText?() ?? false) {
      if KeyableWindow.isShiftReturn(event), let handler = onShiftEnter {
        handler()
        return
      }
      if let bytes = KeyableWindow.optionKeySequence(event), let handler = onOptionKey {
        handler(bytes)
        return
      }
    }
    super.sendEvent(event)
  }
```

In `attach(to:)`, replace the `w.onShiftEnter = { … }` block with:

```swift
    // Through SwiftTerm's own send(data:), not straight to onInput: that is
    // where a scrolled-up reader is brought back to the bottom (xterm's
    // scrollOnUserInput), and it reaches onInput via the delegate anyway.
    w.onShiftEnter = { [weak self] in
      self?.terminalView.send(data: [0x1b, 0x0d][...])
    }
    w.onOptionKey = { [weak self] bytes in
      self?.terminalView.send(data: bytes[...])
    }
```

Seams, next to `debugAllowsMouseReporting`:

```swift
  public func debugScrollToTop() { terminalView.scroll(toPosition: 0) }
  public func debugIsScrolledUp() -> Bool { terminalView.canScroll && terminalView.scrollPosition < 1 }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path native/ArgusTerminal`
Expected: all PASS (existing Shift+Enter tests included — they capture `onInput`, which the delegate still calls).

- [ ] **Step 5: Commit**

```bash
git add native/ArgusTerminal
git commit -m "$(cat <<'EOF'
fix(native-term): send xterm's bytes for Option+Delete and Option+arrows

With Option no longer Meta, SwiftTerm routed Option+special keys through the
text system and dropped them. Translate the six keys xterm.js special-cases,
and send them (and Shift+Enter) through SwiftTerm's send so typing brings a
scrolled-up reader back to the bottom.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Copy produces the same text as an xterm tile (B2)

**Files:**
- Modify: `OverlayController.swift` (`DropAwareTerminalView`, `OverlayController` callbacks), `ShimTests.swift`, `native/addon/src/addon.mm`, `electron/src/nativeTerminal/types.ts`, `NativeTerminalHost.ts` (+ test), `electron/src/main.ts`, `electron/src/preload.ts`, `client/src/app/ui/TerminalShell.tsx`, `client/src/app/ui/TerminalShell.native.test.tsx`

**Interfaces:**
- Produces: Swift `@objc public var onCopy: ((NSString) -> Void)?`; addon `onCopy(cb: (id: number, text: string) => void): void`; `HostDeps.notifyCopy(id: string, text: string): void`; IPC `native-term:copy` (main→renderer, `{ sessionId, text }`) and `native-term:write-clipboard` (renderer→main, `{ text }`); preload `onCopy(cb: (sessionId: string, text: string) => void): () => void` and `writeClipboard(text: string): void`.

- [ ] **Step 1: Write the failing Swift test**

```swift
  /// ⌘C (Edit ▸ Copy sends copy: to the first responder) hands the selection to
  /// the host instead of writing raw rows to the pasteboard.
  func testCopyHandsTheSelectionToTheHost() {
    let (c, parent) = attachedController()
    _ = parent
    c.setFrame(x: 0, y: 0, width: 400, height: 240)
    c.feed(data: Data("hello world".utf8) as NSData)
    var copied: [String] = []
    c.onCopy = { copied.append($0 as String) }
    c.debugSelectAllAndCopy()
    XCTAssertEqual(copied.count, 1)
    XCTAssertTrue(copied[0].contains("hello world"))
  }
```

(`attachedController()` is the helper added in Task 1.)

- [ ] **Step 2: Write the failing host tests**

In `fakeAddon()` declare `let copyCb: ((id: number, text: string) => void) | undefined;`, add `onCopy: (cb) => { copyCb = cb; },` to the addon object, and return `fireCopy: (i: number, t: string) => copyCb!(i, t)`. In `harness()` add `const copies: Array<[string, string]> = [];`, dep `notifyCopy: (id, text) => copies.push([id, text]),` and return `copies`. Then:

```ts
test('a copy from an overlay is forwarded for its session', () => {
  const { addon, fireCopy } = fakeAddon();
  const { host, copies } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireCopy(1, 'raw\ntext');
  assert.deepEqual(copies, [['s1', 'raw\ntext']]);
});

test('a copy from an unknown overlay is ignored, and a throwing notifyCopy does not escape', () => {
  const { addon, fireCopy } = fakeAddon();
  const { host, copies } = harness(addon, { notifyCopy: () => { throw new Error('boom'); } });
  host.attach('s1', HANDLE, RECT);
  assert.doesNotThrow(() => fireCopy(1, 'x'));
  assert.doesNotThrow(() => fireCopy(99, 'x'));
  assert.deepEqual(copies, []);
});
```

- [ ] **Step 3: Write the failing client test**

In `TerminalShell.native.test.tsx`, extend `api` with `onCopy` and `writeClipboard`:

```tsx
let copyListener: ((sessionId: string, text: string) => void) | undefined;
// inside `api`:
  onCopy: vi.fn((cb: (sessionId: string, text: string) => void) => { copyListener = cb; return () => { copyListener = undefined; }; }),
  writeClipboard: vi.fn(),
```

and append:

```tsx
describe('TerminalShellNativeHole — copy', () => {
  it('formats a native copy exactly as an xterm tile would', async () => {
    const root = mount();
    await act(async () => { root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative />); });
    // Gutter-indented rows the agent wrapped at 30 columns.
    const raw = '  The quick brown fox jumps over\n  the lazy dog.';
    copyListener?.('s1', raw);
    expect(api.writeClipboard).toHaveBeenCalledWith(terminalSelectionToClipboard(raw));
    expect(api.writeClipboard.mock.calls[0][0]).not.toContain('\n');
    await act(async () => root.unmount());
  });

  it('ignores copies for other sessions', async () => {
    const root = mount();
    await act(async () => { root.render(<TerminalShell session={session} socket={socket} theme="dark" useNative />); });
    copyListener?.('other', 'x');
    expect(api.writeClipboard).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
```

with `import { terminalSelectionToClipboard } from '../../hooks/terminalCopy.js';`.

- [ ] **Step 4: Run to verify all fail**

Run: `swift test --package-path native/ArgusTerminal; npm run test:electron; npm test -w client`
Expected: Swift build error (`onCopy`, `debugSelectAllAndCopy`), electron TS errors (`onCopy`, `notifyCopy`), client assertions fail.

- [ ] **Step 5: Implement Swift + addon**

`DropAwareTerminalView`:

```swift
  /// Edit ▸ Copy / ⌘C. Hands the selection to the host rather than writing raw
  /// rows: the agent wraps and gutters its own output, and the text a user
  /// expects is rebuilt by the renderer's terminalSelectionToClipboard — the
  /// same function the xterm path uses. Without a handler, SwiftTerm's copy.
  var onCopyText: ((String) -> Void)?

  override func copy(_ sender: Any) {
    guard let text = getSelection(), !text.isEmpty, let handler = onCopyText else {
      super.copy(sender)
      return
    }
    handler(text)
  }
```

`OverlayController`: add `@objc public var onCopy: ((NSString) -> Void)?` next to `onBell`, and in `init` after the `onDropPaths` wiring:

```swift
    terminalView.onCopyText = { [weak self] text in self?.onCopy?(text as NSString) }
```

Seam:

```swift
  public func debugSelectAllAndCopy() {
    terminalView.selectAll(nil)
    terminalView.copy(NSMenuItem())
  }
```

`addon.mm`: add `Napi::ThreadSafeFunction g_copyTsfn; bool g_hasCopyTsfn = false;` next to the bell TSFN globals; in `Create`, after the `setOnBell:` block:

```objc
  [c setOnCopy:^(NSString* text) {
    if (!g_hasCopyTsfn) return;
    std::string s(text.UTF8String ? text.UTF8String : "");
    g_copyTsfn.BlockingCall([id, s](Napi::Env env, Napi::Function cb) {
      cb.Call({Napi::Number::New(env, id), Napi::String::New(env, s)});
    });
  }];
```

in `Destroy` add `[c setOnCopy:nil];` with the other callbacks; add

```objc
Napi::Value OnCopy(const Napi::CallbackInfo& info) {
  InstallTsfn(info, "argusCopy", &g_copyTsfn, &g_hasCopyTsfn);
  return info.Env().Undefined();
}
```

and `exports.Set("onCopy", Napi::Function::New(env, OnCopy));`.

- [ ] **Step 6: Implement host, main, preload, renderer**

`types.ts`: addon `onCopy(cb: (id: number, text: string) => void): void;`; `HostDeps`:

```ts
  /**
   * Text the user copied from a native terminal. Forwarded so the renderer can
   * format it with terminalSelectionToClipboard — the same text an xterm tile
   * copies — rather than reimplementing that in main.
   */
  notifyCopy(id: string, text: string): void;
```

`NativeTerminalHost` constructor, after `onBell`:

```ts
    this.addon.onCopy((id, text) => {
      try {
        const sessionId = this.byOverlay.get(id);
        if (sessionId) this.deps.notifyCopy(sessionId, text);
      } catch (err) {
        console.error('[native-term] notifyCopy failed for overlay', id, err);
      }
    });
```

`main.ts`: add `clipboard` to the `electron` import; in the host deps:

```ts
    // Raw text first, so ⌘C always puts something on the clipboard even when no
    // renderer answers (window reloading). The owning renderer then replaces it
    // with the formatted text (native-term:write-clipboard).
    notifyCopy: (id: string, text: string) => {
      clipboard.writeText(text);
      sendToNativeTermWindow(id, 'native-term:copy', { sessionId: id, text });
    },
```

and next to the other `native-term:*` handlers:

```ts
  ipcMain.on('native-term:write-clipboard', (_e, { text }: { text: unknown }) => {
    if (typeof text === 'string' && text.length <= 10_000_000) clipboard.writeText(text);
  });
```

`preload.ts`, in the `electronNativeTerminal` bridge:

```ts
  onCopy: (cb: (sessionId: string, text: string) => void): (() => void) => {
    const listener = (_e: unknown, payload: { sessionId: string; text: string }) =>
      cb(payload.sessionId, payload.text);
    ipcRenderer.on('native-term:copy', listener);
    return () => ipcRenderer.off('native-term:copy', listener);
  },
  writeClipboard: (text: string): void => {
    ipcRenderer.send('native-term:write-clipboard', { text });
  },
```

`TerminalShell.tsx` (`TerminalShellNativeHole`): import `terminalSelectionToClipboard` from `'../../hooks/terminalCopy.js'`, add

```tsx
/** The slice of the native-terminal preload bridge that formats copies. */
interface NativeCopyBridge {
  onCopy?(cb: (sessionId: string, text: string) => void): () => void;
  writeClipboard?(text: string): void;
}
```

and an effect next to the drop-paths effect:

```tsx
  // Copy: main already put the raw selection on the clipboard; replace it with
  // the text an xterm tile would copy (gutter stripped, agent-wrapped rows
  // rejoined — see terminalCopy.ts).
  useEffect(() => {
    const bridge = (window as Window & { electronNativeTerminal?: NativeCopyBridge }).electronNativeTerminal;
    if (!bridge?.onCopy) return;
    return bridge.onCopy((id, text) => {
      if (id !== session.id) return;
      bridge.writeClipboard?.(terminalSelectionToClipboard(text));
    });
  }, [session.id]);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `swift test --package-path native/ArgusTerminal && npm run build:native -- --arch=arm64 && npm run verify`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add native electron/src client/src
git commit -m "$(cat <<'EOF'
fix(native-term): copy the same text an xterm tile copies

SwiftTerm copied raw rows: a newline per visual row plus the agent's gutter.
The selection now goes to the owning renderer, which formats it with the
xterm path's terminalSelectionToClipboard; main writes the raw text first so
a copy never silently fails.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Refresh frames respect a reader scrolled up (B3)

**Files:**
- Modify: `OverlayController.swift`, `ShimTests.swift`, `addon.mm`, `types.ts`, `NativeTerminalHost.ts` (+ test)

**Interfaces:**
- Produces: Swift `@objc public var onScrolledUp: ((Bool) -> Void)?` (fires on transitions only); addon `onScrolledUp(cb: (id: number, scrolledUp: boolean) => void): void`.

- [ ] **Step 1: Write the failing Swift test**

```swift
  /// The host needs to know when a reader leaves and returns to the bottom, to
  /// hold back refresh frames meanwhile. Transitions only — not every scroll.
  func testScrolledUpIsReportedOnTransitionsOnly() {
    let (c, parent) = attachedController()
    _ = parent
    c.setFrame(x: 0, y: 0, width: 400, height: 240)
    c.feed(data: Data(String(repeating: "line\r\n", count: 200).utf8) as NSData)
    var reports: [Bool] = []
    c.onScrolledUp = { reports.append($0) }
    c.debugScrollToTop()
    c.debugScrollToTop()
    c.debugScrollToBottom()
    XCTAssertEqual(reports, [true, false])
  }
```

Seam to add: `public func debugScrollToBottom() { terminalView.scroll(toPosition: 1) }`.

- [ ] **Step 2: Write the failing host tests**

In `fakeAddon()`: `let scrolledCb …` with `onScrolledUp: (cb) => { scrolledCb = cb; }` and return `fireScrolledUp: (i: number, up: boolean) => scrolledCb!(i, up)`.

```ts
test('a refresh frame is held back while the reader is scrolled up', () => {
  const { addon, calls, fireScrolledUp } = fakeAddon();
  const { host, emitReplay } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireScrolledUp(1, true);
  calls.length = 0;
  emitReplay('s1', 'FRAME');
  assert.ok(!calls.some((c) => c.startsWith('feed:')), calls.join(','));
});

test('live output still reaches a scrolled-up reader', () => {
  const { addon, calls, fireScrolledUp } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireScrolledUp(1, true);
  emitOutput('s1', 'LIVE');
  assert.ok(calls.includes('feed:1:LIVE'));
});

test('returning to the bottom re-seeds exactly once if a refresh was held back', () => {
  const { addon, calls, fireScrolledUp } = fakeAddon();
  const { host, emitReplay, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireScrolledUp(1, true);
  emitReplay('s1', 'FRAME1');
  emitReplay('s1', 'FRAME2');
  emitOutput('s1', 'LIVE');
  calls.length = 0;
  fireScrolledUp(1, false);
  assert.equal(calls.filter((c) => c === 'feed:1:REPLAY').length, 1, calls.join(','));
  calls.length = 0;
  fireScrolledUp(1, true);
  fireScrolledUp(1, false);
  assert.ok(!calls.some((c) => c.startsWith('feed:')), 'nothing owed, nothing fed');
});

test('returning to the bottom with nothing held back feeds nothing', () => {
  const { addon, calls, fireScrolledUp } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireScrolledUp(1, true);
  calls.length = 0;
  fireScrolledUp(1, false);
  assert.ok(!calls.some((c) => c.startsWith('feed:')));
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `swift test --package-path native/ArgusTerminal; npm run test:electron`
Expected: FAIL (missing `onScrolledUp`).

- [ ] **Step 4: Implement Swift + addon**

`OverlayController`: `@objc public var onScrolledUp: ((Bool) -> Void)?` next to `onCopy`; field `private var lastScrolledUp = false`; replace `public func scrolled(source: TerminalView, position: Double) {}` with:

```swift
  /// Reports when the reader leaves or returns to the bottom, so the host can
  /// hold back refresh frames meanwhile (xterm's shouldPaintReplay). Only on a
  /// transition: this fires for every scrolled line.
  public func scrolled(source: TerminalView, position: Double) {
    let up = source.canScroll && position < 1
    guard up != lastScrolledUp else { return }
    lastScrolledUp = up
    onScrolledUp?(up)
  }
```

If `scrolled(source:position:)` does not fire for `scroll(toPosition:)` in the test, also call the same transition check at the end of `debugScrollToTop`/`debugScrollToBottom` is NOT acceptable — instead confirm in SwiftTerm (`AppleTerminalView.swift` `scrollTo(row:)`) where `terminalDelegate?.scrolled` is invoked and hook the check there via the delegate; report what you found.

`addon.mm`: `g_scrolledTsfn`/`g_hasScrolledTsfn`; in `Create`:

```objc
  [c setOnScrolledUp:^(BOOL up) {
    if (!g_hasScrolledTsfn) return;
    bool isUp = up ? true : false;
    g_scrolledTsfn.BlockingCall([id, isUp](Napi::Env env, Napi::Function cb) {
      cb.Call({Napi::Number::New(env, id), Napi::Boolean::New(env, isUp)});
    });
  }];
```

`[c setOnScrolledUp:nil];` in `Destroy`; `OnScrolledUp` installer (`"argusScrolledUp"`) and `exports.Set("onScrolledUp", …)`.

- [ ] **Step 5: Implement the host**

`types.ts` addon: `onScrolledUp(cb: (id: number, scrolledUp: boolean) => void): void;`

`NativeTerminalHost`:
- fields: `private readonly scrolledUp = new Set<string>();` and `private readonly refreshOwed = new Set<string>();` with a comment citing `replayPolicy.ts`.
- split the constructor's shared `feedLive` into two subscriptions:

```ts
    this.unsubscribers.push(
      deps.onOutput(feedLive),
      // Replacement frames lead with ESC[3J and reprint everything, which throws
      // away a scrolled-up reader's place. Hold them back (xterm's
      // shouldPaintReplay) and re-seed once the reader is back at the bottom.
      deps.onReplay((sessionId, data) => {
        if (this.scrolledUp.has(sessionId) && this.seeded.has(sessionId)) {
          this.refreshOwed.add(sessionId);
          return;
        }
        feedLive(sessionId, data);
      }),
    );
```

- in the constructor after `onCopy`:

```ts
    this.addon.onScrolledUp((id, up) => {
      try {
        const sessionId = this.byOverlay.get(id);
        if (!sessionId) return;
        if (up) {
          this.scrolledUp.add(sessionId);
          return;
        }
        this.scrolledUp.delete(sessionId);
        if (this.refreshOwed.delete(sessionId) && this.shown.has(sessionId)) {
          this.seed(sessionId, id);
        }
      } catch (err) {
        console.error('[native-term] scrolled-up handling failed for overlay', id, err);
      }
    });
```

(`seed` is the unconditional re-seed helper introduced in the previous round; if its name or guard differs, use the function `reseedAfterFontChange` calls for a shown overlay.)
- `detach`: delete from `scrolledUp` and `refreshOwed`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `swift test --package-path native/ArgusTerminal && npm run build:native -- --arch=arm64 && npm run test:electron`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add native electron/src/nativeTerminal
git commit -m "$(cat <<'EOF'
fix(native-term): don't repaint history under a reader who scrolled up

Refresh frames (reseed end, width-change dedup, scrollback purge) lead with
ESC[3J and reprinted the view while the user was reading history. Hold them
back while scrolled up, as the xterm path does, and re-seed once on return.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Re-align after resizes and when output settles (B4)

**Files:**
- Modify: `server/src/services/SessionManager.ts` (+ new test in `SessionManager.output.test.ts`), `electron/src/nativeTerminal/types.ts`, `NativeTerminalHost.ts` (+ test), `electron/src/main.ts`, `ShimTests.swift`

**Interfaces:**
- Produces: `SessionManager.onStatus(cb: (sessionId: string, status: SessionStatus) => void): () => void`; `HostDeps.onStatus(cb: (sessionId: string, status: string) => void): () => void`; `HostDeps.getReplaySnapshot(id: string, flavor?: 'full' | 'screen')`.

- [ ] **Step 1: Write the failing server test**

Append to `server/src/services/SessionManager.output.test.ts` (reuse its existing SessionManager construction pattern; if the file builds sessions differently, follow it):

```ts
test('status changes reach in-process subscribers as well as sockets', () => {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const seen: Array<[string, string]> = [];
  const off = sm.onStatus((id, status) => seen.push([id, status]));
  (sm as any).emitStatus({ sessionId: 's1', status: 'waiting' });
  off();
  (sm as any).emitStatus({ sessionId: 's1', status: 'idle' });
  assert.deepEqual(seen, [['s1', 'waiting']]);
});
```

- [ ] **Step 2: Write the failing Swift test (screen frame keeps history)**

```swift
  /// A realign frame is screen-only: it must not eat the history a reader may
  /// be scrolled into (xterm's resync frame has no ESC[3J for the same reason).
  func testAScreenOnlyFrameKeepsScrollback() {
    let (c, parent) = attachedController()
    _ = parent
    c.setFrame(x: 0, y: 0, width: 400, height: 240)
    c.feed(data: Data(String(repeating: "line\r\n", count: 200).utf8) as NSData)
    let before = c.debugScrollbackRows()
    c.feed(data: Data("\u{1b}[?1049l\u{1b}[2J\u{1b}[Hscreen".utf8) as NSData)
    XCTAssertEqual(c.debugScrollbackRows(), before)
  }
```

Seam: `public func debugScrollbackRows() -> Int { terminalView.getTerminal().buffer.yBase }` (if `yBase` is not public in SwiftTerm 1.20, use the closest public accessor for the scrollback length and note it). If this test FAILS because SwiftTerm's ED 2 pushes the screen into scrollback, stop and report: the realign would then duplicate a screen per settle, and the host must use a different frame.

- [ ] **Step 3: Write the failing host tests**

Harness: add `onStatus: (cb) => { emitStatus = cb; return () => { emitStatus = undefined; }; },` (declare `let emitStatus: ((id: string, s: string) => void) | undefined;`), return `emitStatus: (id: string, s: string) => emitStatus?.(id, s)`, and make `getReplaySnapshot` record the flavor: `getReplaySnapshot: (id, flavor) => { order.push(`snapshot:${id}:${flavor ?? 'full'}`); return { data: flavor === 'screen' ? 'SCREEN' : 'REPLAY' }; },` (update the existing seed-order assertion from `snapshot:s1` to `snapshot:s1:full`). Tests use node:test mock timers:

```ts
test('a forwarded native resize is followed by one screen-only realign', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { addon, calls, fireResize, setGrid } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  calls.length = 0;
  setGrid({ cols: 90, rows: 30 });
  fireResize(1, 90, 30);
  setGrid({ cols: 80, rows: 30 });
  fireResize(1, 80, 30);          // debounced: one realign for the burst
  t.mock.timers.tick(119);
  assert.ok(!calls.includes('feed:1:SCREEN'));
  t.mock.timers.tick(1);
  assert.equal(calls.filter((c) => c === 'feed:1:SCREEN').length, 1, calls.join(','));
});

test('output settling (running → waiting/done) realigns after 450 ms', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { addon, calls } = fakeAddon();
  const { host, emitStatus } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  emitStatus('s1', 'running');
  calls.length = 0;
  emitStatus('s1', 'waiting');
  t.mock.timers.tick(450);
  assert.ok(calls.includes('feed:1:SCREEN'), calls.join(','));
});

test('other status transitions do not realign', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { addon, calls } = fakeAddon();
  const { host, emitStatus } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  calls.length = 0;
  emitStatus('s1', 'idle');
  emitStatus('s1', 'waiting');
  t.mock.timers.tick(1000);
  assert.ok(!calls.includes('feed:1:SCREEN'));
});

test('a realign that comes due after the overlay was hidden or detached feeds nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { addon, calls, fireResize, setGrid } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.attach('s2', HANDLE, { x: 400, y: 20, width: 300, height: 200 });
  setGrid({ cols: 90, rows: 30 });
  fireResize(1, 90, 30);
  fireResize(2, 90, 30);
  host.setRect('s1', { x: 0, y: 0, width: 0, height: 0 });   // hidden
  host.detach('s2');
  calls.length = 0;
  t.mock.timers.tick(1000);
  assert.ok(!calls.some((c) => c.startsWith('feed:')), calls.join(','));
});
```

(`setGrid`/`fireResize` are the helpers the previous round added; if the resize filter drops reports whose grid is not current, set the grid before each `fireResize` as shown.)

- [ ] **Step 4: Run to verify they fail**

Run: `npm test -w server; swift test --package-path native/ArgusTerminal; npm run test:electron`
Expected: FAIL (`onStatus`, `emitStatus`, `debugScrollbackRows`, realign behaviour).

- [ ] **Step 5: Implement the server**

`SessionManager.ts`:

```ts
  /** In-process status subscribers (the native terminal host). */
  private statusSubscribers = new Set<(sessionId: string, status: SessionStatus) => void>();

  onStatus(cb: (sessionId: string, status: SessionStatus) => void): () => void {
    this.statusSubscribers.add(cb);
    return () => { this.statusSubscribers.delete(cb); };
  }

  /** The one place a status change is announced: sockets and in-process subscribers. */
  private emitStatus(payload: { sessionId: string; status: SessionStatus; lastPrompt?: string }): void {
    this.io?.emit('session:status', payload);
    for (const cb of this.statusSubscribers) {
      try {
        cb(payload.sessionId, payload.status);
      } catch (err) {
        console.error('[SessionManager] status subscriber threw:', err);
      }
    }
  }
```

Then replace every `this.io?.emit('session:status', ` with `this.emitStatus(` (8 sites; `grep -n "emit('session:status'" server/src/services/SessionManager.ts` must afterwards show only the line inside `emitStatus`). Check each call's payload type-checks against the helper's parameter; adjust the parameter type if a site passes an extra field, rather than dropping the field.

- [ ] **Step 6: Implement the host + main**

`types.ts` `HostDeps`: change to `getReplaySnapshot(id: string, flavor?: 'full' | 'screen'): { data: string } | undefined;` and add

```ts
  /** Session status changes (running/waiting/done/idle/exited). The host
   *  re-aligns a native view when output settles, as the xterm path does. */
  onStatus(cb: (sessionId: string, status: string) => void): () => void;
```

`NativeTerminalHost.ts`:

```ts
/** After a native resize, and after output settles, the xterm path asks for a
 *  screen-only frame (useTerminal.ts resync(120) / resync(150, 300)) because
 *  the agent's repaint does not always land where the reflowed grid expects. */
const REALIGN_AFTER_RESIZE_MS = 120;
const REALIGN_AFTER_SETTLE_MS = 450;
```

fields: `private readonly realignTimers = new Map<string, ReturnType<typeof setTimeout>>();` and `private readonly lastStatus = new Map<string, string>();`

methods:

```ts
  private scheduleRealign(sessionId: string, delayMs: number): void {
    const prior = this.realignTimers.get(sessionId);
    if (prior) clearTimeout(prior);
    this.realignTimers.set(sessionId, setTimeout(() => {
      this.realignTimers.delete(sessionId);
      this.realign(sessionId);
    }, delayMs));
  }

  /** Feed a screen-only frame: realigns the visible screen, leaves history. */
  private realign(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    if (!this.seeded.has(sessionId) || !this.shown.has(sessionId)) return;
    try {
      this.deps.flushOutput(sessionId);
      const snap = this.deps.getReplaySnapshot(sessionId, 'screen');
      if (snap) this.addon.feed(id, Buffer.from(snap.data, 'utf8'));
    } catch (err) {
      console.error('[native-term] realign failed for', sessionId, err);
    }
  }
```

- in `addon.onResize`, after the `this.deps.resizeSession(sessionId, cols, rows);` that forwards a current report: `this.scheduleRealign(sessionId, REALIGN_AFTER_RESIZE_MS);` and likewise after `setResizeSuspended` applies a pending resize.
- in the constructor: `this.unsubscribers.push(deps.onStatus((sessionId, status) => { const prev = this.lastStatus.get(sessionId); this.lastStatus.set(sessionId, status); if (prev === 'running' && (status === 'waiting' || status === 'done') && this.bySession.has(sessionId)) this.scheduleRealign(sessionId, REALIGN_AFTER_SETTLE_MS); }));`
- `detach`: clear and delete the session's timer; delete `lastStatus`.
- `dispose`: clear all timers.

`main.ts` host deps: `getReplaySnapshot: (id: string, flavor?: 'full' | 'screen') => sm.getReplaySnapshot(id, flavor),` and `onStatus: (cb: (sessionId: string, status: string) => void) => sm.onStatus(cb),`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `swift test --package-path native/ArgusTerminal && npm run verify`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/services electron/src native/ArgusTerminal/Tests
git commit -m "$(cat <<'EOF'
fix(native-term): re-align the screen after resizes and when output settles

The xterm path asks for a screen-only frame 120 ms after a grid change and
when a session goes running -> waiting/done; the native view never did, so a
drifted screen stayed drifted. Status changes now reach in-process
subscribers through one emitStatus helper.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wheel speed and Option fast scroll (B5)

**Files:**
- Modify: `OverlayController.swift` (`KeyableWindow.sendEvent`, `attach(to:)`, `init`), `ShimTests.swift`

**Interfaces:**
- Produces: `static func scrollSensitivity(optionDown: Bool) -> CGFloat` on `OverlayController`; `var onScrollWheel: ((NSEvent) -> Void)?` on `KeyableWindow`.

- [ ] **Step 1: Write the failing tests**

```swift
  /// xterm tiles scroll 3 lines per notch, 10 with Option held
  /// (scrollSensitivity / fastScrollSensitivity in useTerminal.ts).
  func testWheelSensitivityMatchesXterm() {
    XCTAssertEqual(OverlayController.scrollSensitivity(optionDown: false), 3)
    XCTAssertEqual(OverlayController.scrollSensitivity(optionDown: true), 10)
  }

  func testAScrollEventAppliesTheSensitivityForItsModifiers() {
    let (c, parent) = attachedController()
    _ = parent
    c.debugPrepareScroll(optionDown: true)
    XCTAssertEqual(c.debugScrollSensitivity(), 10)
    c.debugPrepareScroll(optionDown: false)
    XCTAssertEqual(c.debugScrollSensitivity(), 3)
  }
```

- [ ] **Step 2: Run to verify they fail**

Run: `swift test --package-path native/ArgusTerminal` → build FAILS.

- [ ] **Step 3: Implement**

`OverlayController`:

```swift
  /// Lines per wheel notch, matching xterm tiles (useTerminal.ts:
  /// scrollSensitivity 3, fastScrollSensitivity 10 with Option).
  static func scrollSensitivity(optionDown: Bool) -> CGFloat { optionDown ? 10 : 3 }

  /// Called for every scroll event before SwiftTerm handles it.
  private func prepareScroll(optionDown: Bool) {
    terminalView.scrollSensitivity = OverlayController.scrollSensitivity(optionDown: optionDown)
  }

  public func debugPrepareScroll(optionDown: Bool) { prepareScroll(optionDown: optionDown) }
  public func debugScrollSensitivity() -> CGFloat { terminalView.scrollSensitivity }
```

In `init`: `terminalView.scrollSensitivity = OverlayController.scrollSensitivity(optionDown: false)`.

`KeyableWindow`: `var onScrollWheel: ((NSEvent) -> Void)?` and in `sendEvent`, before `super.sendEvent(event)`:

```swift
    if event.type == .scrollWheel { onScrollWheel?(event) }
```

`attach(to:)`:

```swift
    w.onScrollWheel = { [weak self] event in
      self?.prepareScroll(optionDown: event.modifierFlags.contains(.option))
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `swift test --package-path native/ArgusTerminal` → PASS.

- [ ] **Step 5: Commit**

```bash
git add native/ArgusTerminal
git commit -m "$(cat <<'EOF'
fix(native-term): scroll at xterm's speed, faster with Option

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Option+click moves the cursor (B6)

**Files:**
- Create: `native/ArgusTerminal/Sources/ArgusTerminal/MoveToCell.swift`
- Modify: `OverlayController.swift` (`KeyableWindow.sendEvent`, `attach(to:)`), `ShimTests.swift`

**Interfaces:**
- Produces: `enum MoveToCell { static func sequence(startX: Int, startY: Int, targetX: Int, targetY: Int, cols: Int, applicationCursor: Bool) -> String }`; `func optionClickSequence(atViewPoint: NSPoint) -> String?` on `OverlayController`.

- [ ] **Step 1: Write the failing tests**

```swift
  /// Port of xterm's normal-buffer moveToCellSequence (MoveToCell.ts): same row
  /// → that many ←/→; other rows → ←/→ counted across row ends.
  func testMoveToCellSameRow() {
    XCTAssertEqual(MoveToCell.sequence(startX: 5, startY: 2, targetX: 1, targetY: 2, cols: 80, applicationCursor: false),
                   String(repeating: "\u{1b}[D", count: 4))
    XCTAssertEqual(MoveToCell.sequence(startX: 1, startY: 2, targetX: 4, targetY: 2, cols: 80, applicationCursor: true),
                   String(repeating: "\u{1b}OC", count: 3))
  }

  func testMoveToCellAcrossRows() {
    // Cursor (x=5,y=3), target (x=2,y=1), 10 cols:
    // colsFromRowEnd(2)=8 + (2-1)*10 + 1 + colsFromRowBeginning(5)=4 → 23 × ←
    XCTAssertEqual(MoveToCell.sequence(startX: 5, startY: 3, targetX: 2, targetY: 1, cols: 10, applicationCursor: false),
                   String(repeating: "\u{1b}[D", count: 23))
    // Cursor (x=2,y=1), target (x=5,y=3): colsFromRowEnd(2)=8 + 10 + 1 + 4 → 23 × →
    XCTAssertEqual(MoveToCell.sequence(startX: 2, startY: 1, targetX: 5, targetY: 3, cols: 10, applicationCursor: false),
                   String(repeating: "\u{1b}[C", count: 23))
  }

  /// No move while scrolled up (xterm requires ybase == ydisp).
  func testOptionClickDoesNothingWhileScrolledUp() {
    let (c, parent) = attachedController()
    _ = parent
    c.setFrame(x: 0, y: 0, width: 400, height: 240)
    c.feed(data: Data(String(repeating: "line\r\n", count: 200).utf8) as NSData)
    c.debugScrollToTop()
    XCTAssertNil(c.optionClickSequence(atViewPoint: NSPoint(x: 5, y: 5)))
  }
```

- [ ] **Step 2: Run to verify they fail**

Run: `swift test --package-path native/ArgusTerminal` → build FAILS.

- [ ] **Step 3: Implement the pure port**

`MoveToCell.swift`:

```swift
/// xterm.js's moveToCellSequence for the normal buffer (MoveToCell.ts), used by
/// Option+click. Coordinates are 0-based cells; the normal buffer only moves
/// horizontally, counting the cells between cursor and target across row ends —
/// the same arithmetic xterm uses, including its off-by-one conventions, so the
/// two engines move the cursor identically.
enum MoveToCell {
  static func sequence(startX: Int, startY: Int, targetX: Int, targetY: Int,
                       cols: Int, applicationCursor: Bool) -> String {
    func seq(_ d: Character) -> String { "\u{1b}" + (applicationCursor ? "O" : "[") + String(d) }
    if startY == targetY {
      let d: Character = startX > targetX ? "D" : "C"
      return String(repeating: seq(d), count: abs(startX - targetX))
    }
    let d: Character = startY > targetY ? "D" : "C"
    let rowDifference = abs(startY - targetY)
    let fromRowEnd = cols - (startY > targetY ? targetX : startX)
    let fromRowBeginning = (startY > targetY ? startX : targetX) - 1
    let cells = fromRowEnd + (rowDifference - 1) * cols + 1 + fromRowBeginning
    return String(repeating: seq(d), count: max(0, cells))
  }
}
```

- [ ] **Step 4: Implement the controller + window hook**

`OverlayController`:

```swift
  /// The arrow-key sequence that moves the cursor to the cell under `p` (a
  /// point in the terminal view's coordinates), or nil when xterm would not
  /// move: scrolled up into history, or no usable geometry.
  public func optionClickSequence(atViewPoint p: NSPoint) -> String? {
    let t = terminalView.getTerminal()
    if terminalView.canScroll && terminalView.scrollPosition < 1 { return nil }
    let size = terminalView.bounds.size
    guard t.cols > 0, t.rows > 0, size.width > 0, size.height > 0 else { return nil }
    let cellW = size.width / CGFloat(t.cols)
    let cellH = size.height / CGFloat(t.rows)
    // SwiftTerm's view is not flipped: y grows upward, row 0 is at the top.
    let y = terminalView.isFlipped ? p.y : size.height - p.y
    let col = min(t.cols - 1, max(0, Int(p.x / cellW)))
    let row = min(t.rows - 1, max(0, Int(y / cellH)))
    return MoveToCell.sequence(startX: t.buffer.x, startY: t.buffer.y, targetX: col, targetY: row,
                               cols: t.cols, applicationCursor: t.applicationCursor)
  }
```

`KeyableWindow`:

```swift
  /// Option+click to move the cursor (xterm's altClickMovesCursor): a mouse-up
  /// within 500 ms of an Option mouse-down, with no selection made, asks the
  /// controller for the arrow keys to send. Events still reach SwiftTerm, so
  /// Option+drag selects as before.
  var onOptionClick: ((NSEvent) -> Void)?
  private var optionDownAt: TimeInterval?
```

in `sendEvent`, before `super.sendEvent(event)`:

```swift
    if event.type == .leftMouseDown {
      let f = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
      optionDownAt = (f == .option && event.clickCount == 1) ? event.timestamp : nil
    } else if event.type == .leftMouseUp, let down = optionDownAt {
      optionDownAt = nil
      if event.timestamp - down < 0.5 {
        super.sendEvent(event)            // let SwiftTerm finish its click first
        onOptionClick?(event)
        return
      }
    }
```

`attach(to:)`:

```swift
    w.onOptionClick = { [weak self] event in
      guard let self else { return }
      if let sel = self.terminalView.getSelection(), sel.count > 1 { return }   // a drag selected text
      let p = self.terminalView.convert(event.locationInWindow, from: nil)
      if let s = self.optionClickSequence(atViewPoint: p), !s.isEmpty {
        self.terminalView.send(txt: s)
      }
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `swift test --package-path native/ArgusTerminal && npm run build:native -- --arch=arm64`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add native/ArgusTerminal
git commit -m "$(cat <<'EOF'
feat(native-term): Option+click moves the cursor, as in xterm tiles

A port of xterm's normal-buffer moveToCellSequence: Option+click without a
drag sends the arrow keys that bring the cursor to the clicked cell.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] `export PATH=~/.nvm/versions/node/v24.16.0/bin:$PATH && npm run verify`
- [ ] `swift test --package-path native/ArgusTerminal` and `npm run build:native -- --arch=arm64`
- [ ] **Live, in `npm run dev`, one native tile next to one xterm tile on the same kind of session.** The controller runs these itself where it can drive the app — keystrokes via `osascript`/CGEvent, results via `screencapture` screenshots and the session's server-side mirror — and lists for the user only what it could not drive:
  - [ ] Option+⌫ deletes a word in Claude's prompt; Option+←/→ jump words; ⌥ò types `@` on an Italian layout
  - [ ] Copy a wrapped multi-line answer from each tile and paste both: identical text
  - [ ] Scroll up in the native tile, trigger a width change elsewhere (resize the window) → the view stays put; scroll back down → the screen is correct
  - [ ] Resize the native tile, wait → no drifted/duplicated block; after a Claude response finishes, the screen is clean
  - [ ] Wheel: similar speed in both tiles; Option+wheel is fast
  - [ ] Option+click in the prompt moves the cursor there
