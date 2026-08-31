# Native Terminal Engine (SwiftTerm) — Design

Date: 2026-08-28
Status: Draft — awaiting review

## Summary

Argus gains a second terminal **engine**, selectable per session. Today every
terminal is xterm.js with the DOM renderer, painting one DOM element per buffer
row. The new engine renders a real macOS terminal — SwiftTerm's `TerminalView` —
inside a borderless child `NSWindow` positioned over the tile's rect.

The native view is a **client**, never an owner: `SessionManager` still owns the
pty, the mirror, and state detection. The native view is fed the same coalesced
output stream a socket room receives, and sends input and resize back through the
same entry points the socket handler uses. Nothing about persistence, state
detection, notifications, or remote access changes.

This is additive. `web` remains the default and the universal fallback.

## Motivation

The current terminal is on xterm's **DOM renderer** by deliberate downgrade
(`client/src/hooks/useTerminal.ts:242`): WebGL and Canvas were dropped in 0.16.13
because they bake a glyph atlas and cell metrics at init and, on a cold Electron
start, bake them wrong. WebGL additionally hit the ~16-context cap at 12 tiles
plus companion terminals. The DOM renderer is correct but is the slowest option
available, and it is the root of the "doesn't feel like a real terminal"
complaint — alongside a long history of scroll, replay, and resize defects.

An alternative was considered and rejected for now: fix the GPU renderer path
(gate atlas init on `document.fonts.ready` + DPR stability, pool contexts). It is
substantially cheaper and remains open. It was not chosen because the user wants
a genuinely native terminal, not a better web one.

## Decisions (locked)

| Question | Decision |
|---|---|
| Engine | **SwiftTerm** (MIT). libghostty disqualified — see below |
| Ownership | Native view is a client of `SessionManager`; never owns a pty |
| Remote / mobile | Always xterm.js, regardless of the session's engine flag |
| Scope | All desktop surfaces — Mosaic tiles and Focus |
| Two viewers, one pty grid | **Native wins**; remote clients letterbox |
| Same session, both engines, same window | Never — one view per session per window |
| Engine choice | Per session, in Create + Clone; default in Settings |
| Shortcuts | None lost — five renderer bindings promoted to app-menu accelerators |
| Live engine switch on a running session | Architecturally possible; **out of scope for v1** |

### Why not libghostty

`ghostty_surface_config_s` takes `command`, `working_directory`, and `env_vars`
(`include/ghostty.h:514-517`): the surface spawns and owns its own process. There
is no feed-bytes entry point — input arrives as key/text events and output comes
from the pty Ghostty owns. That is incompatible with the client model above: it
would break argusd persistence and the mobile xterm.js fallback. Secondary:
no release artifacts, so it builds from source, requiring Zig in CI.

SwiftTerm's client-mode API was verified by execution, not documentation:

| Requirement | Verified |
|---|---|
| View with no process | `TerminalView` constructed bare |
| Stream bytes in | `feed(text:)` / `feed(byteArray:)`, ANSI parsed |
| Scrollback | 500 lines fed, correctly scrolled |
| Resize with no pty | reports 48×15 via `sizeChanged` delegate |
| Input out | delegate `send(source:data:)` returned `"ls -la\r"` |
| Search | `TerminalViewSearch.swift` + `SearchEngine` + `MacFindBarView` |
| Clear scrollback | `Terminal.clearScrollback()` (`Terminal.swift:6768`) |

## Spike results (2026-08-28)

Overlay tracking is **not** a performance problem. 12 child windows tracking
tiles during a 60fps drag:

| | achieved FPS | p95 frame | janky frames |
|---|---|---|---|
| baseline, no overlays | 120.1 | 9.2 ms | 0 |
| 12 overlays tracking | 120.0 | 9.2 ms | 0 |

Main-process `setBounds` cost p50 1.2 ms / p95 3.0 ms, off the renderer's
critical path. The probe used child `BrowserWindow`s — heavier than the native
`NSView` children the real implementation uses — so this is a conservative
upper bound. Window *creation* costs ~12 ms each (~100 ms for a 12-tile mosaic),
mitigated by pre-warming.

**Z-order: measured and confirmed (Gate A, 2026-08-28).** Screenshots stayed
blocked — the dev shell descends from an argusd daemon started days before the
Screen Recording grant, and the daemon does not restart with the app — so
z-order was measured without pixels instead, via
`CGWindowListCopyWindowInfo([.optionOnScreenOnly, …])`, which returns on-screen
windows front-to-back and needs no capture permission. With a borderless child
attached to a parent via `addChildWindow(_:ordered:.above)`:

```
order[0] num=27379 layer=0   <- CHILD  (native overlay)
order[1] num=27378 layer=0   <- PARENT (web content)
```

Same window layer, child in front. A DOM surface lives inside the parent
window's own surface, so this is direct proof that a modal, palette or dropdown
WOULD be occluded by an overlay. **Suppression (§4) is required, not optional.**

**Still unverified (cosmetic, non-blocking):** how an opaque child reads against
`vibrancy: 'sidebar'`. Deferred to implementation — terminals are opaque today,
so the seam is a styling question, not an architectural one.

## 1. Components

### `ArgusTerminalView` (Swift package)

Thin shim over SwiftTerm's `TerminalView`, hosted in a borderless child
`NSWindow`. Deliberately dumb — all policy lives in TypeScript so it is testable.

```
feed(bytes)                  → TerminalView.feed(byteArray:)
onInput(bytes)               ← TerminalViewDelegate.send(source:data:)
onResize(cols, rows)         ← TerminalViewDelegate.sizeChanged(...)
search(term, direction)      → SearchEngine
clearScrollback()            → Terminal.clearScrollback()
setTheme(colors, font, size)
```

### `argus-native-terminal` (N-API addon)

`create(parentHandle) -> id`, `setFrame(id, rect)`, `show/hide/destroy(id)`,
`feed(id, Buffer)`, `setTheme(id, …)`, `search(id, …)`, `clearScrollback(id)`,
plus thread-safe callbacks for input and resize.

Built per-arch (arm64 + x64) and rebuilt against Electron's ABI by the existing
`electron-builder install-app-deps` step, exactly as `node-pty` already is.

### `NativeTerminalHost` (Electron main, TypeScript)

The only new component with meaningful logic, and therefore the only one that
needs real tests. Owns the `overlayId ↔ (sessionId, windowId)` map; subscribes to
session output; forwards input and resize back into `SessionManager`; owns
overlay lifecycle and suppression; degrades to `web` if the addon fails to load.

### Renderer

`TerminalShell` renders the usual tile chrome around a transparent hole. A
`useNativeOverlayRect` hook reports that hole via `ResizeObserver`, layout
effects, and window move/resize.

## 2. Data flow

```
today   pty → SessionManager → coalesced session:output → Socket.io → renderer → xterm.js
native  pty → SessionManager → coalesced session:output → NativeTerminalHost → addon.feed → SwiftTerm
                             ↘ TerminalMirror (unchanged) → Socket.io → phone → xterm.js
```

The server runs **inside the Electron main process** (`electron/src/main.ts:515`
dynamically imports `server/dist/index.js`), so `NativeTerminalHost` reads the
output stream in-process. No socket hop, no renderer round trip.

Governing rule: **`SessionManager` remains the single source of truth, and the
native view is one more subscriber.** Input goes back through `writeToSession`,
resize through `resizeSession` — no new privileged path to the pty. This is what
preserves the mirror (mobile replay), `StateDetector` (status + notifications),
and argusd survival.

### Resize authority

Native wins whenever a native view exists for the session. Remote clients
letterbox. When the native view is destroyed, authority reverts to existing
behaviour.

## 3. Overlay lifecycle

One overlay per `(session, window)`. Sessions already render expanded only in
their owning window, so multi-window needs no new concept — the overlay's parent
is that window's `NSWindow`.

- **Create** when a native session becomes visible in its owning window.
- **Destroy** on session close or window close.
- **Hide, not destroy**, for minimize/collapse — hiding is free, creation is ~12 ms.
- **Pre-warm** at mosaic open to avoid the ~100 ms creation burst.

## 4. Z-order and suppression

A child `NSWindow` is always above its parent's web content, so every DOM surface
above `--z-pop` must suppress overlapping overlays. Blanket suppression is wrong —
hiding twelve terminals to show a tooltip is absurd — so suppression is
**intersection-based**: the renderer knows every overlay rect and every floating
surface rect, and sends the suppress list for those that actually overlap.

| Tier (`client/src/tokens/tokens.css:249-257`) | Components | Rule |
|---|---|---|
| `--z-sheet`, `--z-overlay` | `Overlay`, `Sheet`, `AlertSheet` | suppress all (full-screen dimmers) |
| `--z-pop`, `--z-tooltip`, `--z-toast` | `ContextMenu`, `Tooltip`, `Toast` | suppress intersecting only |

Six primitives own those tiers. A contract test asserts every component rendering
at ≥`--z-pop` goes through the suppression hook, so a new overlay cannot silently
render beneath a terminal.

## 5. Keyboard

Once the native view holds key focus the renderer stops receiving `keydown`.
Four bindings already survive because they are app-menu accelerators
(`electron/src/main.ts:350-431`): `mod+n`, `mod+w`, `mod+k`, `mod+,`.

The five renderer-only bindings (`client/src/keyboard/registry.ts:41-47`) are
promoted to app-menu accelerators, whose handlers IPC the focused renderer:

| Binding | Action | Native implementation |
|---|---|---|
| `mod+d` | Diff for focused shell | none needed — acts on the session |
| `mod+e` | Files for focused shell | none needed — acts on the session |
| `mod+t` | Terminal panel | none needed — acts on the session |
| `mod+f` | Search in terminal | SwiftTerm `SearchEngine` / `MacFindBarView` |
| `mod+l` | Clear scrollback | `Terminal.clearScrollback()` |

**Net: no shortcuts are lost.** User rebinds must regenerate the menu
accelerators, so `AppConfig.keyboardShortcuts` becomes an input to menu
construction in main.

**Open:** `shift+enter` (`terminal-newline`) is currently intercepted in the
renderer and sent as `ESC+CR`. SwiftTerm will apply its own encoding. Behaviour
must be verified against a real Claude session; if it differs, intercept in the
Swift shim and emit the same bytes.

## 6. Engine selection

```ts
// shared/src/types.ts
interface SessionInfo {
  terminalEngine?: 'web' | 'native';  // default 'web'
}
```

Persisted in `sessions.json`. Picker in Create and Clone sheets; default in
Settings. Falls back to `web` — silently, always — for `/mobile`, any
non-Electron client, non-macOS, or addon load failure. The flag is a
*preference*, never a guarantee.

## 7. Testing

| Layer | Method |
|---|---|
| `ArgusTerminalView` | XCTest: feed → grid, resize → cols/rows, input → delegate |
| `NativeTerminalHost` | `node:test` with an injected fake addon — map, lifecycle, resize authority, fallback |
| Renderer | vitest: rect reporting, suppression hook, engine selection/fallback |
| Z-order coverage | contract test over the `--z-pop`+ token tiers |
| Pixels, real z-order | manual smoke checklist — not automatable |

## 8. Build and release

Every piece has precedent. `node-pty` is already a native module rebuilt via
`electron-builder install-app-deps`; `argusd` is already a per-arch Mach-O in
`extraResources` ad-hoc signed by `electron/afterPack.cjs`.

- `electron-builder.config.cjs:78` ships `arch: ['arm64', 'x64']` — the addon and
  Swift framework must build for both, like `argusd-${process.arch}`.
- `asarUnpack` entry for the `.node` binary.
- New runtime deps must go in the **root** `package.json` (`check:deps` guards it).
- Swift 6.2 / Xcode 26 are present on the macos-15 CI runner.

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | ~~Z-order unverified~~ | **CLOSED** — measured via CGWindowList: child orders above parent, suppression required. Vibrancy seam remains open but is cosmetic |
| 2 | Suppression coverage gap | Contract test over z-tiers |
| 3 | Two-arch native build + `afterPack` signing | Follow the `argusd` pattern; verify on a real packaged build |
| 4 | `shift+enter` encoding | Verify against a live agent; intercept in the shim if needed |
| 5 | IME composition unverified | **ACCEPTED RISK** — typing, `insertText`, and multi-byte UTF-8 all verified; `setMarkedText` never observed. Mitigated by the per-session xterm.js fallback. Revisit before making native the default |
| 6 | Selection/clipboard interop with Argus | Unprobed |
| 7 | Addon load failure | Bulletproof fallback to `web`; covered by tests |

## 10. Pre-implementation gates

Two risks are **blocking** — implementation does not start until both are closed,
because either could invalidate the design rather than merely complicate it:

- ~~**Risk 1 (z-order).**~~ **CLOSED 2026-08-28** — measured with
  `CGWindowListCopyWindowInfo`; the child window orders above the parent, so
  suppression is required. The vibrancy seam is cosmetic and does not gate work.
- ~~**Risk 5 (IME, dead keys, VoiceOver).**~~ **CLOSED 2026-08-28 as accepted
  risk.** Verified by real typing in a borderless child window: keyboard input
  reaches the view, the `NSTextInputClient` path is engaged (`insertText:` fires
  per key), and multi-byte UTF-8 flows correctly to the delegate
  (`insertText: ´` -> `send bytes: c2 b4`) — which is the mechanism accented
  characters use. Composition (`setMarkedText`) never fired and is UNVERIFIED;
  a control comparing a normal window against a child window showed identical
  behaviour, so nothing indicates the child window is at fault, but the control
  synthesized its own `NSEvent`s and therefore could not exercise real
  composition. Accepted because the target user's layout has no dead keys and no
  CJK requirement, and because the engine is per-session: any session needing IME
  can use xterm.js, where it demonstrably works. **Revisit if native becomes the
  default or ships to users who need composition input.**

## 11. Phasing

This is too large for a single implementation plan. Three phases, each shippable
and independently verifiable:

**Phase 1 — prove the pipe.** Swift shim, N-API addon, `NativeTerminalHost`, one
overlay, Focus mode only, engine hardcoded behind a dev flag. Success: a real
Claude session renders in SwiftTerm, accepts input, resizes, and the phone can
still attach over xterm.js simultaneously.

**Phase 2 — the desktop surface.** Mosaic, multiple overlays, lifecycle
(create/hide/destroy/pre-warm), intersection-based suppression plus its contract
test, multi-window parenting.

**Phase 3 — product surface.** `terminalEngine` in the schema, Create/Clone
pickers, Settings default, menu-accelerator migration for the five bindings,
search and clear wiring, fallback paths, packaging for both arches.

Each phase gets its own implementation plan. Phase 1 is the one that can still
kill the approach cheaply.

## 12. Out of scope

- Live engine switching on a running session.
- Native rendering on `/mobile` or any remote client.
- Replacing xterm.js. The web path remains default and fallback.
- Fixing the GPU-renderer path — still open, independently.
