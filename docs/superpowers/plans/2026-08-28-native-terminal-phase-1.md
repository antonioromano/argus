# Native Terminal Engine — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render one live Argus session in a real macOS terminal (SwiftTerm) inside a child `NSWindow` over the Focus-mode terminal pane, while the same session stays fully attachable from a phone over xterm.js.

**Architecture:** SwiftTerm's `TerminalView` runs in a borderless child `NSWindow` parented to the Electron window. It is a **client**, never an owner: `SessionManager` keeps the pty, the mirror and state detection. A new `onOutput` subscription feeds the native view the same coalesced byte stream a socket room gets; input and resize return through the existing `writeToSession` / `resizeSession`. All policy lives in TypeScript (`NativeTerminalHost`) so it is unit-testable; the Swift and N-API layers stay dumb shims.

**Tech Stack:** SwiftTerm (MIT, SwiftPM), Swift 6.2, N-API via `node-addon-api`, Electron 42, TypeScript ESM, `node:test`, Vitest, XCTest.

**Spec:** `docs/superpowers/specs/2026-08-28-native-terminal-engine-design.md`

## Global Constraints

- macOS only. Every native path must degrade to `web` on failure — never throw into a render path.
- The native view **never owns a pty**. Only `SessionManager.writeToSession` / `resizeSession` mutate session state.
- Targets both `arm64` and `x64` (`electron-builder.config.cjs:78`). Phase 1 may build host-arch only, but must not hardcode an arch.
- TypeScript strict, ES2022, ESM. Server imports use `.js` extensions.
- New runtime deps go in the **root** `package.json` — `npm run check:deps` enforces it.
- Node 24 (`.nvmrc`). `nvm use` before any npm command; Node 18 breaks the Vite build.
- Phase 1 is gated behind `ARGUS_NATIVE_TERM=1`. No user-visible UI in this phase.
- Existing suites must stay green: `npm run lint -w client`, `npm run build:all`, `npm test`.

---

## Gate A: Confirm z-order and vibrancy

**Blocking.** The spec's suppression design assumes a child `NSWindow` always paints above parent web content. That is AppKit semantics, but it was never observed — `screencapture` returned desktop-only images because the terminal lacks Screen Recording permission.

- [ ] **Step 1: Grant permission**

Ask the user to enable System Settings → Privacy & Security → Screen Recording for their terminal app, then restart it.

- [ ] **Step 2: Re-run the spike harness with a modal**

The harness from the design spike lives in the session scratchpad; if gone, recreate it as a minimal Electron app with `vibrancy: 'sidebar'`, one child `BrowserWindow` over a DOM tile, and a fixed-position DOM div at `z-index: 9999`.

Run it and capture: `screencapture -x /tmp/zorder.png`

- [ ] **Step 3: Read the capture and record the verdict**

Expected: the DOM div is **hidden behind** the child window, confirming suppression is required.
Also record how the opaque child reads against the sidebar vibrancy.

If the DOM div renders *above* the child window, the entire suppression section of the spec is unnecessary — **stop and revise the spec** before continuing.

- [ ] **Step 4: Write the finding into the spec**

Update the "Not verified" paragraph in the spec's Spike results section with the observed result, and mark Risk 1 closed in the risk table.

```bash
git add docs/superpowers/specs/2026-08-28-native-terminal-engine-design.md
git commit -m "docs: close z-order/vibrancy gate with observed result"
```

---

## Gate B: IME, dead keys, VoiceOver spike

**Blocking.** If SwiftTerm cannot accept IME composition inside a borderless child window, the engine choice is wrong and Phase 1 should not be built.

- [ ] **Step 1: Build a throwaway host**

A single Swift executable: borderless child `NSWindow` over a parent window, containing a `SwiftTerm.TerminalView` with a delegate that prints every `send(source:data:)` payload as hex.

- [ ] **Step 2: Probe three inputs**

Manually verify and record:
1. Dead keys — `Option+e` then `e` should emit `é` (one UTF-8 sequence), not two events.
2. IME — switch to a Japanese or Pinyin input source, type a word, confirm the candidate window appears *and* is not clipped by the child window bounds.
3. VoiceOver — `Cmd+F5`, confirm the terminal view reports content rather than an empty group.

- [ ] **Step 3: Record the verdict**

Write findings into the spec's Risk 5 row. IME candidate-window clipping is the likely failure; if it clips, note whether `NSTextInputClient` positioning can be corrected before deciding.

If IME is unusable and uncorrectable, **stop** — report to the user and revisit the engine decision.

```bash
git add docs/superpowers/specs/2026-08-28-native-terminal-engine-design.md
git commit -m "docs: close IME/accessibility gate"
```

---

## File Structure

| Path | Responsibility |
|---|---|
| `server/src/services/SessionManager.ts` (modify) | add `onOutput` subscriber registry |
| `server/src/services/SessionManager.output.test.ts` (create) | tests for the registry |
| `server/src/index.ts` (modify) | export `getSessionManager()` |
| `native/ArgusTerminal/Package.swift` (create) | SwiftPM manifest, depends on SwiftTerm |
| `native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift` (create) | child `NSWindow` + `TerminalView` shim |
| `native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift` (create) | XCTest for feed/resize/input |
| `native/addon/binding.gyp` (create) | N-API build |
| `native/addon/src/addon.mm` (create) | N-API ↔ Swift bridge |
| `electron/src/nativeTerminal/NativeTerminalHost.ts` (create) | all policy: map, lifecycle, forwarding |
| `electron/src/nativeTerminal/types.ts` (create) | `NativeTerminalAddon` interface (enables the fake) |
| `electron/src/nativeTerminal/NativeTerminalHost.test.ts` (create) | `node:test` against a fake addon |
| `electron/src/main.ts` (modify) | wire host, IPC channels |
| `electron/src/preload.ts` (modify) | expose rect reporting |
| `client/src/app/ui/TerminalShell.tsx` (modify) | transparent hole when native |
| `client/src/hooks/useNativeOverlayRect.ts` (create) | rect reporting |
| `client/src/hooks/useNativeOverlayRect.test.ts` (create) | Vitest |

---

## Task 1: Output subscription hook in SessionManager

`flushOutput` (`server/src/services/SessionManager.ts:1152`) emits only to `this.io`. The native host needs the same stream in-process.

**Files:**
- Modify: `server/src/services/SessionManager.ts:1152-1165`
- Create: `server/src/services/SessionManager.output.test.ts`

**Interfaces:**
- Produces: `onOutput(cb: (sessionId: string, data: string) => void): () => void` — returns an unsubscribe function. Called synchronously inside `flushOutput`, after the socket emit, with the identical payload.

- [ ] **Step 1: Write the failing test**

```ts
// server/src/services/SessionManager.output.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

const fakeConfig = {
  load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }),
  save: async () => {},
} as any;

function fixture() {
  const sm = new SessionManager(os.tmpdir(), fakeConfig);
  const emits: any[] = [];
  (sm as any).io = {
    to: () => ({ emit: (event: string, payload: any) => emits.push({ event, payload }) }),
    emit: () => {},
  };
  (sm as any).sessions.set('s1', { id: 's1', pendingOutput: 'hello', flushTimer: undefined });
  return { sm, emits };
}

test('onOutput receives the same payload the socket room gets', () => {
  const { sm, emits } = fixture();
  const seen: Array<[string, string]> = [];
  sm.onOutput((id, data) => seen.push([id, data]));

  sm.flushOutput('s1');

  assert.deepEqual(seen, [['s1', 'hello']]);
  assert.equal(emits[0].payload.data, 'hello');
});

test('onOutput returns an unsubscribe that stops delivery', () => {
  const { sm } = fixture();
  const seen: string[] = [];
  const off = sm.onOutput((_id, data) => seen.push(data));
  off();

  sm.flushOutput('s1');

  assert.deepEqual(seen, []);
});

test('a throwing subscriber cannot break the socket emit', () => {
  // A native-side crash must never stop web clients from receiving output.
  const { sm, emits } = fixture();
  sm.onOutput(() => { throw new Error('addon exploded'); });

  sm.flushOutput('s1');

  assert.equal(emits[0].payload.data, 'hello');
});

test('no output means no notification', () => {
  const { sm } = fixture();
  (sm as any).sessions.set('s2', { id: 's2', pendingOutput: '', flushTimer: undefined });
  const seen: string[] = [];
  sm.onOutput((_id, d) => seen.push(d));

  sm.flushOutput('s2');

  assert.deepEqual(seen, []);
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
nvm use 24 && npx tsx --test server/src/services/SessionManager.output.test.ts
```
Expected: FAIL — `sm.onOutput is not a function`.

- [ ] **Step 3: Implement**

Add the field near the other private state in `SessionManager`:

```ts
  /** In-process output subscribers (the native terminal host). Parallel to the
   *  socket room: same payload, same moment. A subscriber must never be able to
   *  break socket delivery, so each call is individually guarded. */
  private outputSubscribers = new Set<(sessionId: string, data: string) => void>();
```

Add the public method beside `flushOutput`:

```ts
  onOutput(cb: (sessionId: string, data: string) => void): () => void {
    this.outputSubscribers.add(cb);
    return () => { this.outputSubscribers.delete(cb); };
  }
```

In `flushOutput`, after the existing `this.io?.to(id).emit(...)` line:

```ts
      for (const cb of this.outputSubscribers) {
        try {
          cb(id, data);
        } catch (err) {
          console.error('[SessionManager] output subscriber threw:', err);
        }
      }
```

- [ ] **Step 4: Run tests**

```bash
npx tsx --test server/src/services/SessionManager.output.test.ts
npm test -w server
```
Expected: all PASS.

- [ ] **Step 5: Export the singleton for the host**

In `server/src/index.ts`, beside the other host exports (`setWindowHooks`, ~line 178):

```ts
/** The in-process SessionManager, for Electron main to wire the native terminal
 *  host. Main runs the server in-process (electron/src/main.ts:515), so this is
 *  a direct reference — no socket hop. */
export function getSessionManager(): SessionManager {
  return sessionManager;
}
```

- [ ] **Step 6: Build and commit**

```bash
npm run build:all
git add server/src/services/SessionManager.ts server/src/services/SessionManager.output.test.ts server/src/index.ts
git commit -m "feat(server): in-process output subscription for the native terminal host"
```

---

## Task 2: Swift shim — `ArgusTerminal`

**Files:**
- Create: `native/ArgusTerminal/Package.swift`
- Create: `native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift`
- Create: `native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift`

**Interfaces:**
- Produces: `OverlayController`, **`@objc`-exposed throughout** so Task 3's Objective-C++ can call it. Swift arrays and `[UInt8]` closures do not bridge to Objective-C, so the surface is deliberately expressed in bridgeable types: `feed(data: NSData)`, `attach(to: NSWindow)`, `setFrame(x:y:width:height:)` (all `CGFloat`), `show()`, `hide()`, `clearScrollback()`, `destroy()`, and block properties `onInput: ((NSData) -> Void)?`, `onResize: ((Int, Int) -> Void)?`.

- [ ] **Step 1: Write the manifest**

```swift
// native/ArgusTerminal/Package.swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ArgusTerminal",
  platforms: [.macOS(.v13)],
  products: [.library(name: "ArgusTerminal", type: .dynamic, targets: ["ArgusTerminal"])],
  dependencies: [.package(url: "https://github.com/migueldeicaza/SwiftTerm", from: "1.2.0")],
  targets: [
    .target(name: "ArgusTerminal", dependencies: ["SwiftTerm"]),
    .testTarget(name: "ArgusTerminalTests", dependencies: ["ArgusTerminal"]),
  ]
)
```

- [ ] **Step 2: Write the failing test**

```swift
// native/ArgusTerminal/Tests/ArgusTerminalTests/ShimTests.swift
import XCTest
@testable import ArgusTerminal

final class ShimTests: XCTestCase {
  func testFedBytesLandInTheGrid() {
    let c = OverlayController(width: 800, height: 480)
    c.feed(data: Data("hello\u{1b}[31m red\u{1b}[0m".utf8) as NSData)
    XCTAssertEqual(c.debugRow(0), "hello red")
  }

  func testResizeReportsNewGrid() {
    let c = OverlayController(width: 800, height: 480)
    var reported: (Int, Int)?
    c.onResize = { cols, rows in reported = (cols, rows) }
    c.setFrame(x: 0, y: 0, width: 400, height: 240)
    XCTAssertNotNil(reported)
    XCTAssertLessThan(reported!.0, 98)   // narrower than the 800px grid
  }

  func testUserInputReachesTheCallback() {
    let c = OverlayController(width: 800, height: 480)
    var got = Data()
    c.onInput = { data in got = data as Data }
    c.simulateInput("ls -la\r")
    XCTAssertEqual(String(decoding: got, as: UTF8.self), "ls -la\r")
  }

  func testClearScrollbackKeepsTheVisibleScreen() {
    let c = OverlayController(width: 800, height: 480)
    for i in 0..<200 { c.feed(data: Data("line \(i)\r\n".utf8) as NSData) }
    let before = c.debugRow(0)
    c.clearScrollback()
    XCTAssertEqual(c.debugRow(0), before)
  }
}
```

- [ ] **Step 3: Run and confirm it fails**

```bash
cd native/ArgusTerminal && swift test
```
Expected: FAIL — `cannot find 'OverlayController' in scope`.

- [ ] **Step 4: Implement the shim**

```swift
// native/ArgusTerminal/Sources/ArgusTerminal/OverlayController.swift
import AppKit
import SwiftTerm

/// A SwiftTerm view in a borderless child NSWindow, driven entirely from
/// outside. Deliberately dumb: it owns no process and makes no decisions —
/// all policy lives in NativeTerminalHost (TypeScript), where it is testable.
@objc public final class OverlayController: NSObject, TerminalViewDelegate {
  // Block properties, not Swift closures over [UInt8] — those do not bridge.
  @objc public var onInput: ((NSData) -> Void)?
  @objc public var onResize: ((Int, Int) -> Void)?

  private let terminalView: TerminalView
  private var window: NSWindow?

  @objc public init(width: CGFloat, height: CGFloat) {
    terminalView = TerminalView(frame: NSRect(x: 0, y: 0, width: width, height: height))
    super.init()
    terminalView.terminalDelegate = self
  }

  /// Attach as a child of the Electron window. `parent` is the NSWindow behind
  /// BrowserWindow.getNativeWindowHandle().
  @objc public func attach(to parent: NSWindow) {
    let w = NSWindow(contentRect: terminalView.frame,
                     styleMask: [.borderless], backing: .buffered, defer: false)
    w.contentView = terminalView
    w.isOpaque = true
    w.hasShadow = false
    w.ignoresMouseEvents = false
    parent.addChildWindow(w, ordered: .above)
    window = w
  }

  @objc public func feed(data: NSData) {
    let bytes = [UInt8](Data(referencing: data))
    terminalView.feed(byteArray: bytes[...])
  }

  /// Frame in SCREEN coordinates; the caller converts from the tile rect.
  @objc public func setFrame(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
    let r = NSRect(x: x, y: y, width: max(1, width), height: max(1, height))
    terminalView.frame = NSRect(origin: .zero, size: r.size)
    window?.setFrame(r, display: true)
  }

  @objc public func show() { window?.orderFront(nil) }
  @objc public func hide() { window?.orderOut(nil) }
  @objc public func clearScrollback() { terminalView.getTerminal().clearScrollback() }

  @objc public func destroy() {
    window?.parent?.removeChildWindow(window!)
    window?.orderOut(nil)
    window = nil
  }

  // Test seams — never called in production.
  public func debugRow(_ row: Int) -> String {
    terminalView.getTerminal().getLine(row: row)?.translateToString(trimRight: true) ?? ""
  }
  public func simulateInput(_ text: String) { terminalView.send(txt: text) }

  // MARK: TerminalViewDelegate
  public func send(source: TerminalView, data: ArraySlice<UInt8>) {
    onInput?(Data(data) as NSData)
  }
  public func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) { onResize?(newCols, newRows) }
  public func setTerminalTitle(source: TerminalView, title: String) {}
  public func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
  public func scrolled(source: TerminalView, position: Double) {}
  public func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
  public func clipboardCopy(source: TerminalView, content: Data) {}
  public func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
  public func bell(source: TerminalView) {}
}
```

- [ ] **Step 5: Run tests**

```bash
cd native/ArgusTerminal && swift test
```
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add native/ArgusTerminal
git commit -m "feat(native): SwiftTerm shim in a child NSWindow"
```

---

## Task 3: N-API addon

**Files:**
- Create: `native/addon/binding.gyp`
- Create: `native/addon/src/addon.mm`

**Interfaces:**
- Consumes: `OverlayController` from Task 2.
- Produces: a module matching `NativeTerminalAddon` (Task 4's `types.ts`) exactly:
  `create(parentHandle: Buffer): number`, `setFrame(id, x, y, w, h): void`,
  `show(id): void`, `hide(id): void`, `destroy(id): void`, `feed(id, data: Buffer): void`,
  `clearScrollback(id): void`, `onInput(cb: (id: number, data: Buffer) => void): void`,
  `onResize(cb: (id: number, cols: number, rows: number) => void): void`.

- [ ] **Step 1: Write the build file**

```python
# native/addon/binding.gyp
{
  "targets": [{
    "target_name": "argus_native_terminal",
    "sources": ["src/addon.mm"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
    "xcode_settings": {
      "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-fobjc-arc"],
      "MACOSX_DEPLOYMENT_TARGET": "13.0",
      "OTHER_LDFLAGS": ["-F../ArgusTerminal/.build/release", "-framework", "ArgusTerminal"]
    }
  }]
}
```

- [ ] **Step 2: Implement the bridge**

```objc
// native/addon/src/addon.mm
#import <Cocoa/Cocoa.h>
#import <ArgusTerminal/ArgusTerminal-Swift.h>
#include <napi.h>
#include <map>

static std::map<uint32_t, OverlayController*> g_overlays;
static uint32_t g_nextId = 1;
static Napi::ThreadSafeFunction g_inputTsfn;
static Napi::ThreadSafeFunction g_resizeTsfn;

static OverlayController* Lookup(const Napi::CallbackInfo& info, uint32_t* outId) {
  uint32_t id = info[0].As<Napi::Number>().Uint32Value();
  auto it = g_overlays.find(id);
  if (outId) *outId = id;
  return it == g_overlays.end() ? nil : it->second;
}

// BrowserWindow.getNativeWindowHandle() yields an NSView*, NOT an NSWindow*.
static Napi::Value Create(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto buf = info[0].As<Napi::Buffer<char>>();
  NSView* view = *reinterpret_cast<NSView* __unsafe_unretained*>(buf.Data());
  NSWindow* parent = [view window];

  uint32_t id = g_nextId++;
  OverlayController* c = [[OverlayController alloc] initWithWidth:800 height:480];
  [c attachTo:parent];

  // SwiftTerm fires these on the main thread; the TSFN keeps ordering into JS.
  [c setOnInput:^(NSData* data) {
    std::string bytes((const char*)data.bytes, data.length);
    g_inputTsfn.BlockingCall([id, bytes](Napi::Env env, Napi::Function cb) {
      cb.Call({ Napi::Number::New(env, id), Napi::Buffer<char>::Copy(env, bytes.data(), bytes.size()) });
    });
  }];
  [c setOnResize:^(NSInteger cols, NSInteger rows) {
    g_resizeTsfn.BlockingCall([id, cols, rows](Napi::Env env, Napi::Function cb) {
      cb.Call({ Napi::Number::New(env, id), Napi::Number::New(env, cols), Napi::Number::New(env, rows) });
    });
  }];

  g_overlays[id] = c;
  return Napi::Number::New(env, id);
}

static Napi::Value SetFrame(const Napi::CallbackInfo& info) {
  OverlayController* c = Lookup(info, nullptr);
  if (c) [c setFrameWithX:info[1].As<Napi::Number>().DoubleValue()
                        y:info[2].As<Napi::Number>().DoubleValue()
                    width:info[3].As<Napi::Number>().DoubleValue()
                   height:info[4].As<Napi::Number>().DoubleValue()];
  return info.Env().Undefined();
}

static Napi::Value Feed(const Napi::CallbackInfo& info) {
  OverlayController* c = Lookup(info, nullptr);
  if (c) {
    auto buf = info[1].As<Napi::Buffer<char>>();
    [c feedWithData:[NSData dataWithBytes:buf.Data() length:buf.Length()]];
  }
  return info.Env().Undefined();
}

static Napi::Value Show(const Napi::CallbackInfo& info) { OverlayController* c = Lookup(info, nullptr); if (c) [c show]; return info.Env().Undefined(); }
static Napi::Value Hide(const Napi::CallbackInfo& info) { OverlayController* c = Lookup(info, nullptr); if (c) [c hide]; return info.Env().Undefined(); }
static Napi::Value ClearScrollback(const Napi::CallbackInfo& info) { OverlayController* c = Lookup(info, nullptr); if (c) [c clearScrollback]; return info.Env().Undefined(); }

static Napi::Value Destroy(const Napi::CallbackInfo& info) {
  uint32_t id = 0;
  OverlayController* c = Lookup(info, &id);
  if (c) { [c destroy]; g_overlays.erase(id); }
  return info.Env().Undefined();
}

static Napi::Value OnInput(const Napi::CallbackInfo& info) {
  g_inputTsfn = Napi::ThreadSafeFunction::New(info.Env(), info[0].As<Napi::Function>(), "argusInput", 0, 1);
  return info.Env().Undefined();
}
static Napi::Value OnResize(const Napi::CallbackInfo& info) {
  g_resizeTsfn = Napi::ThreadSafeFunction::New(info.Env(), info[0].As<Napi::Function>(), "argusResize", 0, 1);
  return info.Env().Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("create", Napi::Function::New(env, Create));
  exports.Set("setFrame", Napi::Function::New(env, SetFrame));
  exports.Set("show", Napi::Function::New(env, Show));
  exports.Set("hide", Napi::Function::New(env, Hide));
  exports.Set("destroy", Napi::Function::New(env, Destroy));
  exports.Set("feed", Napi::Function::New(env, Feed));
  exports.Set("clearScrollback", Napi::Function::New(env, ClearScrollback));
  exports.Set("onInput", Napi::Function::New(env, OnInput));
  exports.Set("onResize", Napi::Function::New(env, OnResize));
  return exports;
}

NODE_API_MODULE(argus_native_terminal, Init)
```

Note: this compiles against the `@objc` surface Task 2 already defines. The
generated header `ArgusTerminal-Swift.h` only appears after `swift build`, so
Task 2 must be built before this target — the build order in Step 3 does that.

- [ ] **Step 3: Build against Electron's ABI**

```bash
cd native/ArgusTerminal && swift build -c release && cd ../..
npx node-gyp rebuild --directory=native/addon \
  --target=$(node -p "require('electron/package.json').version") \
  --dist-url=https://electronjs.org/headers
```
Expected: `argus_native_terminal.node` produced.

- [ ] **Step 4: Smoke-load it**

```bash
npx electron -e "const a=require('./native/addon/build/Release/argus_native_terminal.node'); console.log(Object.keys(a));"
```
Expected: the nine exported names.

- [ ] **Step 5: Commit**

```bash
git add native/addon
git commit -m "feat(native): N-API bridge for the SwiftTerm shim"
```

---

## Task 4: `NativeTerminalHost`

The only component with real logic, and the only one fully unit-testable. Written against an injected addon interface so tests need no native build.

**Files:**
- Create: `electron/src/nativeTerminal/types.ts`
- Create: `electron/src/nativeTerminal/NativeTerminalHost.ts`
- Create: `electron/src/nativeTerminal/NativeTerminalHost.test.ts`

**Interfaces:**
- Consumes: `onOutput` (Task 1), the addon shape (Task 3).
- Produces: `new NativeTerminalHost(deps)` with `attach(sessionId, windowHandle, rect)`, `setRect(sessionId, rect)`, `hide(sessionId)`, `show(sessionId)`, `detach(sessionId)`, `isAvailable(): boolean`.

- [ ] **Step 1: Define the injectable interface**

```ts
// electron/src/nativeTerminal/types.ts
export interface Rect { x: number; y: number; width: number; height: number }

/** The N-API surface. Declared as an interface so tests inject a fake and the
 *  host's logic is testable without building any native code. */
export interface NativeTerminalAddon {
  create(parentHandle: Buffer): number;
  setFrame(id: number, x: number, y: number, w: number, h: number): void;
  show(id: number): void;
  hide(id: number): void;
  destroy(id: number): void;
  feed(id: number, data: Buffer): void;
  clearScrollback(id: number): void;
  onInput(cb: (id: number, data: Buffer) => void): void;
  onResize(cb: (id: number, cols: number, rows: number) => void): void;
}

export interface HostDeps {
  addon: NativeTerminalAddon | null;   // null => unavailable, fall back to web
  onOutput(cb: (sessionId: string, data: string) => void): () => void;
  writeToSession(id: string, data: string): void;
  resizeSession(id: string, cols: number, rows: number): void;
  getReplaySnapshot(id: string): { data: string } | undefined;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// electron/src/nativeTerminal/NativeTerminalHost.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeTerminalHost } from './NativeTerminalHost.js';
import type { NativeTerminalAddon } from './types.js';

function fakeAddon() {
  const calls: string[] = [];
  let next = 1;
  let inputCb: ((id: number, d: Buffer) => void) | undefined;
  let resizeCb: ((id: number, c: number, r: number) => void) | undefined;
  const addon: NativeTerminalAddon = {
    create: () => { calls.push(`create:${next}`); return next++; },
    setFrame: (id, x, y, w, h) => calls.push(`setFrame:${id}:${x},${y},${w},${h}`),
    show: (id) => calls.push(`show:${id}`),
    hide: (id) => calls.push(`hide:${id}`),
    destroy: (id) => calls.push(`destroy:${id}`),
    feed: (id, d) => calls.push(`feed:${id}:${d.toString()}`),
    clearScrollback: (id) => calls.push(`clear:${id}`),
    onInput: (cb) => { inputCb = cb; },
    onResize: (cb) => { resizeCb = cb; },
  };
  return { addon, calls, fireInput: (i: number, s: string) => inputCb!(i, Buffer.from(s)),
           fireResize: (i: number, c: number, r: number) => resizeCb!(i, c, r) };
}

function harness(addonOrNull: NativeTerminalAddon | null) {
  const wrote: Array<[string, string]> = [];
  const resized: Array<[string, number, number]> = [];
  let emit: ((id: string, data: string) => void) | undefined;
  const host = new NativeTerminalHost({
    addon: addonOrNull,
    onOutput: (cb) => { emit = cb; return () => { emit = undefined; }; },
    writeToSession: (id, d) => wrote.push([id, d]),
    resizeSession: (id, c, r) => resized.push([id, c, r]),
    getReplaySnapshot: () => ({ data: 'REPLAY' }),
  });
  return { host, wrote, resized, emitOutput: (id: string, d: string) => emit?.(id, d) };
}

const HANDLE = Buffer.alloc(8);
const RECT = { x: 10, y: 20, width: 300, height: 200 };

test('attach creates an overlay and seeds it with the replay frame', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  assert.ok(calls.includes('create:1'));
  assert.ok(calls.includes('feed:1:REPLAY'), `expected replay seed, got ${calls.join(',')}`);
  assert.ok(calls.includes('setFrame:1:10,20,300,200'));
});

test('session output is fed only to that session overlay', () => {
  const { addon, calls } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.attach('s2', HANDLE, RECT);
  emitOutput('s1', 'abc');
  assert.ok(calls.includes('feed:1:abc'));
  assert.ok(!calls.includes('feed:2:abc'));
});

test('output for an unattached session is ignored', () => {
  const { addon, calls } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  const before = calls.length;
  emitOutput('other', 'zzz');
  assert.equal(calls.length, before);
});

test('user input is routed back to the right session', () => {
  const { addon, fireInput } = fakeAddon();
  const { host, wrote } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireInput(1, 'ls\r');
  assert.deepEqual(wrote, [['s1', 'ls\r']]);
});

test('native resize drives the pty — native is the resize authority', () => {
  const { addon, fireResize } = fakeAddon();
  const { host, resized } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  fireResize(1, 120, 40);
  assert.deepEqual(resized, [['s1', 120, 40]]);
});

test('detach destroys the overlay and stops feeding it', () => {
  const { addon, calls } = fakeAddon();
  const { host, emitOutput } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.detach('s1');
  assert.ok(calls.includes('destroy:1'));
  const before = calls.length;
  emitOutput('s1', 'after');
  assert.equal(calls.length, before, 'must not feed a destroyed overlay');
});

test('hide keeps the overlay alive; show reuses it rather than recreating', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.hide('s1');
  host.show('s1');
  assert.ok(calls.includes('hide:1'));
  assert.ok(calls.includes('show:1'));
  assert.equal(calls.filter((c) => c.startsWith('create:')).length, 1);
});

test('with no addon the host is unavailable and every call is inert', () => {
  const { host, wrote } = harness(null);
  assert.equal(host.isAvailable(), false);
  host.attach('s1', HANDLE, RECT);   // must not throw
  host.setRect('s1', RECT);
  host.detach('s1');
  assert.deepEqual(wrote, []);
});

test('attaching twice reuses the existing overlay', () => {
  const { addon, calls } = fakeAddon();
  const { host } = harness(addon);
  host.attach('s1', HANDLE, RECT);
  host.attach('s1', HANDLE, { x: 1, y: 2, width: 9, height: 9 });
  assert.equal(calls.filter((c) => c.startsWith('create:')).length, 1);
  assert.ok(calls.includes('setFrame:1:1,2,9,9'));
});
```

- [ ] **Step 3: Run and confirm failure**

```bash
npx tsx --test electron/src/nativeTerminal/NativeTerminalHost.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// electron/src/nativeTerminal/NativeTerminalHost.ts
import type { HostDeps, NativeTerminalAddon, Rect } from './types.js';

/**
 * Owns every native terminal overlay. The native view is a CLIENT of
 * SessionManager: it is fed the same coalesced stream a socket room receives,
 * and its input/resize go back through the ordinary session entry points. It
 * never touches a pty.
 *
 * All policy lives here rather than in Swift so it can be tested without a
 * native build — the addon is injected.
 */
export class NativeTerminalHost {
  private readonly addon: NativeTerminalAddon | null;
  private readonly deps: HostDeps;
  private readonly bySession = new Map<string, number>();
  private readonly byOverlay = new Map<number, string>();
  private unsubscribe?: () => void;

  constructor(deps: HostDeps) {
    this.deps = deps;
    this.addon = deps.addon;
    if (!this.addon) return;

    this.unsubscribe = deps.onOutput((sessionId, data) => {
      const id = this.bySession.get(sessionId);
      if (id === undefined) return;               // not shown natively — ignore
      this.addon!.feed(id, Buffer.from(data, 'utf8'));
    });

    this.addon.onInput((id, data) => {
      const sessionId = this.byOverlay.get(id);
      if (sessionId) this.deps.writeToSession(sessionId, data.toString('utf8'));
    });

    // Native is the resize authority whenever an overlay exists (spec §2).
    this.addon.onResize((id, cols, rows) => {
      const sessionId = this.byOverlay.get(id);
      if (sessionId) this.deps.resizeSession(sessionId, cols, rows);
    });
  }

  isAvailable(): boolean {
    return this.addon !== null;
  }

  attach(sessionId: string, parentHandle: Buffer, rect: Rect): void {
    if (!this.addon) return;
    let id = this.bySession.get(sessionId);
    if (id === undefined) {
      id = this.addon.create(parentHandle);
      this.bySession.set(sessionId, id);
      this.byOverlay.set(id, sessionId);
      // Seed with the same replay frame a joining socket gets, so the native
      // view opens on the current screen instead of an empty one.
      const snap = this.deps.getReplaySnapshot(sessionId);
      if (snap) this.addon.feed(id, Buffer.from(snap.data, 'utf8'));
    }
    this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height);
    this.addon.show(id);
  }

  setRect(sessionId: string, rect: Rect): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    this.addon.setFrame(id, rect.x, rect.y, rect.width, rect.height);
  }

  show(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id !== undefined) this.addon?.show(id);
  }

  hide(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id !== undefined) this.addon?.hide(id);
  }

  detach(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id === undefined || !this.addon) return;
    this.addon.destroy(id);
    this.bySession.delete(sessionId);
    this.byOverlay.delete(id);
  }

  dispose(): void {
    for (const sessionId of [...this.bySession.keys()]) this.detach(sessionId);
    this.unsubscribe?.();
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npx tsx --test electron/src/nativeTerminal/NativeTerminalHost.test.ts
```
Expected: 9 PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/src/nativeTerminal
git commit -m "feat(electron): NativeTerminalHost — overlay lifecycle and session wiring"
```

---

## Task 5: Wire the host into main

**Files:**
- Modify: `electron/src/main.ts` (after the `server` import, ~line 515)
- Modify: `electron/src/preload.ts`

**Interfaces:**
- Consumes: `getSessionManager()` (Task 1), `NativeTerminalHost` (Task 4).
- Produces: IPC channels `native-term:attach` `{sessionId, rect}`, `native-term:rect` `{sessionId, rect}`, `native-term:detach` `{sessionId}`; and `window.argus.nativeTerminal` in the renderer.

- [ ] **Step 1: Load the addon defensively**

```ts
// electron/src/main.ts — near the server wiring
import { NativeTerminalHost } from './nativeTerminal/NativeTerminalHost.js';
import type { NativeTerminalAddon } from './nativeTerminal/types.js';

/** Phase 1 is opt-in. A missing or broken addon must degrade to web, never throw. */
function loadNativeTerminalAddon(): NativeTerminalAddon | null {
  if (process.env.ARGUS_NATIVE_TERM !== '1' || process.platform !== 'darwin') return null;
  try {
    return require('../../native/addon/build/Release/argus_native_terminal.node');
  } catch (err) {
    console.warn('[native-term] addon unavailable, using xterm.js:', err);
    return null;
  }
}
```

- [ ] **Step 2: Construct the host and register IPC**

```ts
const sm = server.getSessionManager();
const nativeTerminal = new NativeTerminalHost({
  addon: loadNativeTerminalAddon(),
  onOutput: (cb) => sm.onOutput(cb),
  writeToSession: (id, d) => sm.writeToSession(id, d),
  resizeSession: (id, c, r) => sm.resizeSession(id, c, r),
  getReplaySnapshot: (id) => sm.getReplaySnapshot(id),
});

ipcMain.on('native-term:attach', (e, { sessionId, rect }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) nativeTerminal.attach(sessionId, win.getNativeWindowHandle(), rect);
});
ipcMain.on('native-term:rect', (_e, { sessionId, rect }) => nativeTerminal.setRect(sessionId, rect));
ipcMain.on('native-term:detach', (_e, { sessionId }) => nativeTerminal.detach(sessionId));
ipcMain.handle('native-term:available', () => nativeTerminal.isAvailable());
```

Call `nativeTerminal.dispose()` alongside the existing shutdown handling.

- [ ] **Step 3: Expose it in the preload**

```ts
// electron/src/preload.ts — inside the existing contextBridge object
nativeTerminal: {
  available: () => ipcRenderer.invoke('native-term:available'),
  attach: (sessionId: string, rect: Rect) => ipcRenderer.send('native-term:attach', { sessionId, rect }),
  setRect: (sessionId: string, rect: Rect) => ipcRenderer.send('native-term:rect', { sessionId, rect }),
  detach: (sessionId: string) => ipcRenderer.send('native-term:detach', { sessionId }),
},
```

- [ ] **Step 4: Typecheck and commit**

```bash
npm run build:all
git add electron/src/main.ts electron/src/preload.ts
git commit -m "feat(electron): wire NativeTerminalHost behind ARGUS_NATIVE_TERM"
```

---

## Task 6: Renderer — the transparent hole (Focus only)

**Files:**
- Create: `client/src/hooks/useNativeOverlayRect.ts`
- Create: `client/src/hooks/useNativeOverlayRect.test.ts`
- Modify: `client/src/app/ui/TerminalShell.tsx`

**Interfaces:**
- Consumes: `window.argus.nativeTerminal` (Task 5).
- Produces: `useNativeOverlayRect(sessionId: string, enabled: boolean): React.RefObject<HTMLDivElement>` — attach the ref to the hole element; the hook attaches on mount, reports on every geometry change, and detaches on unmount.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/hooks/useNativeOverlayRect.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useNativeOverlayRect } from './useNativeOverlayRect.js';

const api = { attach: vi.fn(), setRect: vi.fn(), detach: vi.fn(), available: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  (window as any).argus = { nativeTerminal: api };
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe({ enabled }: { enabled: boolean }) {
  const ref = useNativeOverlayRect('s1', enabled);
  return <div ref={ref} data-testid="hole" />;
}

describe('useNativeOverlayRect', () => {
  it('attaches with the hole rect when enabled', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<Probe enabled />));
    expect(api.attach).toHaveBeenCalledTimes(1);
    expect(api.attach.mock.calls[0][0]).toBe('s1');
    act(() => root.unmount());
  });

  it('does nothing at all when disabled — the web path must be untouched', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<Probe enabled={false} />));
    expect(api.attach).not.toHaveBeenCalled();
    expect(api.setRect).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('detaches on unmount so the overlay cannot outlive its tile', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    act(() => root.render(<Probe enabled />));
    act(() => root.unmount());
    expect(api.detach).toHaveBeenCalledWith('s1');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
nvm use 24 && npx vitest run src/hooks/useNativeOverlayRect.test.ts --root client
```
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement**

```ts
// client/src/hooks/useNativeOverlayRect.ts
import { useEffect, useRef } from 'react';

interface Rect { x: number; y: number; width: number; height: number }

/**
 * Reports the rect of the transparent "hole" a native terminal overlay must
 * cover. The renderer owns geometry truth; main only mirrors it onto the child
 * NSWindow. Measured at 12 tiles / 120fps with no frame cost (see the spec's
 * spike results), so reporting on every geometry change is affordable.
 */
export function useNativeOverlayRect(sessionId: string, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const lastRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) return;
    const api = window.argus?.nativeTerminal;
    const el = ref.current;
    if (!api || !el) return;

    const measure = (): Rect => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    };

    const report = () => {
      const rect = measure();
      // Skip identical rects: layout effects fire on plenty of triggers that
      // don't move the hole, and each IPC hop is pure waste.
      const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
      if (key === lastRef.current) return;
      lastRef.current = key;
      api.setRect(sessionId, rect);
    };

    api.attach(sessionId, measure());
    lastRef.current = '';

    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener('resize', report);
    window.addEventListener('scroll', report, true);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
      window.removeEventListener('scroll', report, true);
      api.detach(sessionId);
    };
  }, [sessionId, enabled]);

  return ref;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/hooks/useNativeOverlayRect.test.ts --root client
```
Expected: 3 PASS.

- [ ] **Step 5: Render the hole in TerminalShell**

In `client/src/app/ui/TerminalShell.tsx`, add an optional `useNative?: boolean` prop. When true, skip the xterm mount entirely and render the hole instead — same box, `background: 'transparent'`:

```tsx
  const holeRef = useNativeOverlayRect(sessionId, !!useNative);
  if (useNative) {
    return <div ref={holeRef} style={{ flex: 1, minHeight: 0, background: 'transparent' }} />;
  }
```

Wire `useNative` in the Focus view only, from `import.meta.env.VITE_ARGUS_NATIVE_TERM === '1'` plus an `available()` check.

- [ ] **Step 6: Verify the web path is untouched**

```bash
npm run lint -w client && npm test -w client
```
Expected: all existing terminal tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/hooks/useNativeOverlayRect.ts client/src/hooks/useNativeOverlayRect.test.ts client/src/app/ui/TerminalShell.tsx
git commit -m "feat(client): transparent hole + rect reporting for native overlays"
```

---

## Task 7: End-to-end smoke

No automated coverage exists for pixels or real window layering; this is the manual gate that closes Phase 1.

**Files:**
- Create: `docs/superpowers/plans/native-terminal-phase-1-smoke.md`

- [ ] **Step 1: Run the app with the flag**

```bash
nvm use 24 && ARGUS_NATIVE_TERM=1 VITE_ARGUS_NATIVE_TERM=1 npm run dev
```

- [ ] **Step 2: Walk the checklist and record results**

1. Create a Claude session, open Focus. Terminal renders in SwiftTerm.
2. Type — input reaches the agent; output streams back.
3. Resize the window — grid reflows, no duplicated transcript.
4. Scroll with the wheel — scrollback works.
5. **Attach from a phone over ngrok while native is open** — the phone shows the same session in xterm.js, both live. This is the core architectural claim of the spec.
6. Quit and relaunch — session survives (argusd untouched).
7. Unset the flag and relaunch — everything falls back to xterm.js with no visible change.
8. Break the addon path deliberately — app still starts, logs the warning, uses xterm.js.

- [ ] **Step 3: Commit the results**

```bash
git add docs/superpowers/plans/native-terminal-phase-1-smoke.md
git commit -m "docs: Phase 1 smoke results"
```

---

## Definition of done

- Gates A and B closed and recorded in the spec.
- `npm run lint -w client`, `npm run build:all`, `npm test` all green.
- `swift test` green in `native/ArgusTerminal`.
- Smoke checklist recorded, item 5 (simultaneous native + phone) passing.
- With the flag unset, behaviour is byte-for-byte the current app.
