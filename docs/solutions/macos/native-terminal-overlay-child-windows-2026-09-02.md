---
title: Native terminal overlay — child NSWindow visibility and placement gotchas
date: 2026-09-02
category: docs/solutions/macos/
module: native, electron, client
problem_type: rendering_bug
component: native SwiftTerm overlay (child NSWindow), native-term host
severity: high
applies_when:
  - A stray, ghost or misplaced native terminal window appears
  - Changing how native overlays are created, shown, hidden, destroyed or positioned
  - Adding CSS animations/transforms to tiles that host a native overlay
tags:
  - appkit
  - nswindow
  - swiftterm
  - native-overlay
  - debugging-method
---

Native terminal tiles are child `NSWindow`s floated over a transparent DOM "hole". The JS host logic
was provably correct for days; every one of these bugs lived in AppKit below it. Reasoning from code
got it wrong 4+ times; measuring found each one.

1. **`addChildWindow` on a visible parent orders the child in immediately**, at its construction size
   (800×480 at the default origin), before `show()` is ever called. Create overlays at **alpha 0**.
2. **`orderOut` did not take a former child off screen.** AppKit reported `isVisible=false` while
   `CGWindowListCopyWindowInfo` still listed it as painted. Hide with `alphaValue = 0` +
   `ignoresMouseEvents` + refusing key. The overlay always stays a child, and nothing relies on ordering.
3. **`destroy()` must `close()`**, with `isReleasedWhenClosed = false` (otherwise ARC double-releases).
   With only `orderOut`, every tile remount leaked a painted ghost.
4. **Window managers see the overlay as a real window.** It must be key-eligible for keyboard input, so
   a "center window" shortcut moved the terminal. Return `nil` from `accessibilityRole()` and `false`
   from `isAccessibilityElement()`, and restore the applied frame on any move or resize the controller
   didn't cause.
5. **A child NSWindow is clipped by nothing.** Intersect the frame with the parent's content rect, but
   keep the terminal view at its full logical size inside a container. Native owns cols/rows, so
   cropping must not resize the terminal.
6. **A pure CSS translate fires neither ResizeObserver nor IntersectionObserver.** A tile fade-in from
   `translateY(4px)` left the overlay 4px low forever. Re-measure on document-level capture listeners
   for `animationend`, `animationcancel` and `transitionend` (dnd-kit reorders have the same shape).
7. **Round the hole rect inward, edge by edge** (ceil the near edges, floor the far ones). Rounding
   x/y and w/h independently pushed both far edges 1px onto the tile border.

## How to debug

Set `ARGUS_NATIVE_TERM_DEBUG=1`. The Swift shim then dumps every on-screen window this PID owns
(`[native-term:appkit]`, from `CGWindowListCopyWindowInfo`, synchronously on each hide). Match window
numbers against the `attach created #N` lines. A window at 800×480 was created and never shown.
`window.ts` mirrors renderer trace lines to the terminal under the same flag.
