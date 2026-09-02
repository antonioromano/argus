import AppKit
import SwiftTerm

/// A borderless NSWindow returns `canBecomeKey == false` by default, so it can
/// never take keyboard focus and the terminal inside it receives nothing. This
/// override is load-bearing — verified during Gate B, where a plain
/// `NSWindow(styleMask: [.borderless])` reported `canBecomeKey: false`.
/// `canBecomeMain` stays false so the Electron window remains the main window.
final class KeyableWindow: NSWindow {
  /// Cleared while the overlay is hidden. A hidden overlay is kept on screen
  /// at alpha 0 (see OverlayController.hide), and an invisible window that can
  /// still become key would swallow keystrokes with nowhere to show them.
  var allowsKey = true
  override var canBecomeKey: Bool { allowsKey }
  override var canBecomeMain: Bool { false }

  /// Reports key-window transitions so the renderer can learn that a native
  /// tile is the focused one. Clicking a native tile puts the click into THIS
  /// window, not the web contents, so React's focus tracking — which every
  /// "for the focused shell" command reads — would otherwise never fire for
  /// a native tile at all. Overriding becomeKey/resignKey rather than
  /// observing NSWindow.didBecomeKeyNotification keeps the lifetime tied to
  /// the window itself, with no observer to unregister.
  var onKeyChange: ((Bool) -> Void)?

  override func becomeKey() {
    super.becomeKey()
    onKeyChange?(true)
  }

  override func resignKey() {
    super.resignKey()
    onKeyChange?(false)
  }

  /// The frame OverlayController last applied. An external mover (a window
  /// manager, or anything driving the Accessibility API) that changes this
  /// window's frame is undone on the next frame-change notification.
  var appliedFrame: NSRect?
  /// Set while the controller itself is calling setFrame, so its own change is
  /// not mistaken for an external one.
  var applyingFrame = false

  /// Hide the overlay from the Accessibility API. Window managers (Spectacle,
  /// Rectangle, macOS's own window commands) act on an app's AX focused
  /// window, and this window becomes key whenever a native tile is clicked —
  /// so "center window" centered the TERMINAL rather than Argus, which is
  /// exactly what a manageable window is supposed to do. It is an
  /// implementation detail of a tile, not a window a user should be able to
  /// target, so it declines to be one. `canBecomeKey` is untouched: keyboard
  /// focus is how SwiftTerm receives input.
  override func accessibilityRole() -> NSAccessibility.Role? { nil }
  override func isAccessibilityElement() -> Bool { false }
}

/// Temporary AppKit-level tracing, on with ARGUS_NATIVE_TERM_DEBUG=1 (the same
/// switch as the host's). The JS-side trace proved the host and this class are
/// being asked to hide correctly; what it cannot see is whether AppKit agrees.
private let overlayDebug = ProcessInfo.processInfo.environment["ARGUS_NATIVE_TERM_DEBUG"] == "1"

private func otrace(_ items: Any...) {
  guard overlayDebug else { return }
  let line = items.map { "\($0)" }.joined(separator: " ")
  FileHandle.standardError.write(("[native-term:appkit] " + line + "\n").data(using: .utf8)!)
}

/// Every on-screen window belonging to this process, from the window server's
/// point of view — the ground truth for "is something still painted". Layer 0
/// only, so menus/tooltips do not clutter it.
private func dumpOnScreenWindows(_ label: String) {
  guard overlayDebug else { return }
  let pid = ProcessInfo.processInfo.processIdentifier
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] else { return }
  let mine = list.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == pid }
  otrace("on-screen windows (\(label)): \(mine.count)")
  for w in mine {
    let num = w[kCGWindowNumber as String] as? Int ?? -1
    let layer = w[kCGWindowLayer as String] as? Int ?? -1
    let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let name = w[kCGWindowName as String] as? String ?? ""
    // optionOnScreenOnly filters by ORDERING, not opacity — an alpha-0 window
    // is still listed. The window server's own alpha reading is what says
    // whether anything is actually painted.
    let alpha = w[kCGWindowAlpha as String] as? Double ?? -1
    otrace("  #\(num) layer=\(layer) alpha=\(alpha) bounds=\(bounds) name='\(name)'")
  }
}

/// A scrim that never takes a click. A plain NSView subview would sit in front
/// of the terminal in the hit-test chain and swallow every mouse event —
/// selection, link clicks, scroll — so the tile would look right and stop
/// responding. Returning nil from hitTest passes events straight through, the
/// AppKit equivalent of the DOM scrim's `pointer-events: none`.
final class PassthroughView: NSView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// A SwiftTerm view in a borderless child NSWindow, driven entirely from
/// outside. Deliberately dumb: it owns no process and makes no decisions —
/// all policy lives in NativeTerminalHost (TypeScript), where it is testable.
@objc public final class OverlayController: NSObject, TerminalViewDelegate {
  // Block properties, not Swift closures over [UInt8] — those do not bridge.
  @objc public var onInput: ((NSData) -> Void)?
  @objc public var onResize: ((Int, Int) -> Void)?
  /// A link the user activated in the terminal (an OSC 8 hyperlink, or a
  /// plain URL SwiftTerm detected by regex). Routed to JS rather than opened
  /// here — see `requestOpenLink` below.
  @objc public var onOpenLink: ((NSString) -> Void)?
  /// `true` when this overlay's window became key, `false` when it resigned.
  @objc public var onFocus: ((Bool) -> Void)?

  private let terminalView: TerminalView
  private var window: NSWindow?
  /// The parent to (re-)attach to. Tracked separately from `window.parent`
  /// because hiding detaches the child, and both setFrame's coordinate
  /// conversion and show() still need to know where it belongs.
  private weak var parentWindow: NSWindow?
  /// Whether hide() has been called and not yet undone by show(). Kept so a
  /// reparent while hidden updates the target without revealing the overlay.
  private var hiddenByHost = false
  /// Translucent scrim shown over the terminal while its tile is unfocused.
  /// Lives INSIDE the overlay's own window: the equivalent DOM element the
  /// xterm path uses (`.argus-tile-overlay`) renders behind a child NSWindow
  /// and would be invisible — the same z-order constraint that moved search
  /// into SwiftTerm's own find bar.
  private var dimView: NSView?
  /// The window's content view. The terminal view sits inside it and may be
  /// offset so that only the portion of the hole that is actually inside the
  /// parent's content area is shown — see setFrame.
  private let clipView = NSView()
  /// True when setFrame found the hole entirely outside the parent's content
  /// area. Independent of hiddenByHost: the host decides whether the tile is
  /// logically visible, this decides whether any of it is physically inside
  /// the window it belongs to. Both must be false for the overlay to paint.
  private var clippedOut = false
  /// didMove/didResize observers on the overlay window, removed on destroy.
  private var frameObservers: [NSObjectProtocol] = []

  @objc public init(width: CGFloat, height: CGFloat) {
    terminalView = TerminalView(frame: NSRect(x: 0, y: 0, width: width, height: height))
    super.init()
    terminalView.terminalDelegate = self
    // SwiftTerm defaults to `.hoverWithModifier`: a plain URL is only
    // highlighted while Command is held, and only Command-click opens it.
    // Argus's xterm.js path opens links on an ordinary click (see
    // terminalLinks.ts's link provider), so the two engines would disagree
    // about the same transcript. `.hover` matches xterm: underline on hover,
    // open on click.
    terminalView.linkHighlightMode = .hover
  }

  /// Attach as a child of the Electron window. `parent` is the NSWindow behind
  /// BrowserWindow.getNativeWindowHandle().
  @objc public func attach(to parent: NSWindow) {
    // Idempotent: a second attach reparents rather than orphaning the first
    // window. Without this, the old window leaks with nothing referencing it.
    if window != nil {
      reparent(to: parent)
      return
    }
    let w = KeyableWindow(contentRect: terminalView.frame,
                          styleMask: [.borderless], backing: .buffered, defer: false)
    // The terminal view is NOT the content view: setFrame crops the window to
    // the part of the hole inside the parent and offsets the terminal view
    // inside this container so the visible portion lines up — the same thing
    // the browser does to the DOM tile when it overflows the viewport.
    clipView.frame = terminalView.frame
    clipView.wantsLayer = true
    terminalView.frame.origin = .zero
    clipView.addSubview(terminalView)
    w.contentView = clipView
    w.isOpaque = true
    w.hasShadow = false
    w.ignoresMouseEvents = false
    // destroy() calls close(); with the default (true) AppKit would also
    // release the window, and ARC releasing it a second time is a crash.
    w.isReleasedWhenClosed = false
    // Read through the controller's own property at call time (rather than
    // capturing it) so a later `onFocus =` assignment — the ObjC++ layer sets
    // it after init — is picked up, and so clearing it to nil on destroy
    // genuinely stops delivery. `self` is unowned-safe here: the window is
    // torn down in destroy(), before the controller can go away.
    w.onKeyChange = { [weak self] isKey in self?.onFocus?(isKey) }
    // Start HIDDEN. addChildWindow on a visible parent orders the child in at
    // once, so without this every overlay is on screen from the moment it is
    // created — at its 800x480 construction size, at the default origin. The
    // host's state machine assumes a fresh overlay is not shown, so when its
    // first decision is "don't show" (a tile mid-mount, or behind a maximized
    // workbench) there is no transition and hide() is never called. Measured:
    // that is exactly the stray 800x480 window seen bottom-left of the screen.
    // Only show() reveals an overlay; nothing else may.
    w.alphaValue = 0
    w.ignoresMouseEvents = true
    w.allowsKey = false
    w.isExcludedFromWindowsMenu = true
    parentWindow = parent
    hiddenByHost = true
    parent.addChildWindow(w, ordered: .above)
    window = w
    // Undo any frame change this class did not make. A window manager can
    // move or resize the overlay directly (see accessibilityRole above for
    // why it is reachable at all); the hole in the web contents has not
    // moved, so the only correct response is to put it back.
    frameObservers = [
      NotificationCenter.default.addObserver(
        forName: NSWindow.didMoveNotification, object: w, queue: .main
      ) { [weak self] _ in self?.restoreAppliedFrameIfMovedExternally() },
      NotificationCenter.default.addObserver(
        forName: NSWindow.didResizeNotification, object: w, queue: .main
      ) { [weak self] _ in self?.restoreAppliedFrameIfMovedExternally() },
    ]
    otrace("attach created #\(w.windowNumber) parent=#\(parent.windowNumber)")
  }

  /// Move an existing overlay to a different parent window. Argus supports
  /// multiple windows and a session can move between them.
  @objc public func reparent(to parent: NSWindow) {
    parentWindow = parent
    guard let w = window else { return }
    w.parent?.removeChildWindow(w)
    // Re-adding orders the child in, which is harmless: a hidden overlay is
    // hidden by alpha (see hide()), not by ordering, so it stays invisible.
    parent.addChildWindow(w, ordered: .above)
  }

  /// Overrides SwiftTerm's default, which hands the link straight to
  /// `NSWorkspace.shared.open`. That would bypass the scheme allowlist every
  /// other Argus link path goes through (main.ts's `shell:openExternal`
  /// permits only http(s) and mailto), so a transcript could emit an OSC 8
  /// hyperlink with any scheme at all and a single click would launch it.
  /// Routing to JS keeps one allowlist for both engines.
  public func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
    onOpenLink?(link as NSString)
  }

  // Test seams — not @objc, so invisible across the ObjC++ boundary.
  public func debugWindowNumber() -> Int { window.map { Int($0.windowNumber) } ?? -1 }
  public func debugParentWindowNumber() -> Int { window?.parent.map { Int($0.windowNumber) } ?? -1 }

  @objc public func feed(data: NSData) {
    let bytes = [UInt8](Data(referencing: data))
    terminalView.feed(byteArray: bytes[...])
  }

  /// `x`/`y`/`width`/`height` are VIEWPORT coordinates of the tile's
  /// transparent "hole", exactly as `useNativeOverlayRect.ts` measures them
  /// with `getBoundingClientRect()`:
  ///   - origin is the top-left of the renderer's web content (below any
  ///     title bar), NOT the top-left of the screen or of the parent
  ///     NSWindow's frame.
  ///   - y increases DOWNWARD.
  ///   - units are CSS px, which on macOS are AppKit points (both are
  ///     "logical"/un-scaled; Retina scaling is a backing-store concern
  ///     window/view geometry never deals in).
  ///
  /// AppKit screen coordinates (what `NSWindow.setFrame` takes) are the
  /// opposite on both axes: origin is the bottom-left of the screen, y
  /// increases UPWARD. Converting therefore needs two things this method
  /// used to skip entirely: adding the parent's own on-screen position, and
  /// flipping the Y axis around the parent's content area.
  ///
  /// The reference point is the parent's CONTENT rect
  /// (`contentRect(forFrameRect:)`), not its frame rect: the frame rect
  /// includes the title bar, but the renderer's y=0 is the top of the web
  /// content, which sits BELOW the title bar. Using the frame rect here
  /// would shift every overlay up by the title bar's height.
  ///
  /// Worked example: a parent window whose content rect is
  /// (x: 100, y: 200, width: 1000, height: 700) in screen coordinates
  /// (so its content spans screen y ∈ [200, 900]), and a viewport rect of
  /// (x: 40, y: 60, width: 300, height: 150) — 40px in from the left edge of
  /// the web content, 60px down from its top:
  ///   childX = 100 + 40                     = 140
  ///   childY = 900 - 60 - 150 = (200+700) - 60 - 150 = 690
  /// i.e. the child window's screen frame is (140, 690, 300, 150). Note the
  /// flip: a LARGER viewport y (further down the page) produces a SMALLER
  /// screen y (further down the screen, since screen y grows upward) — got
  /// exactly backwards, this was Bug 1 (the overlay rendered vertically
  /// inverted relative to its tile).
  ///
  /// A missing `window` (no `attach()` yet) or missing `window.parent`
  /// leaves nothing to convert against; `x`/`y` are used as-is so the
  /// terminal grid still resizes correctly (`terminalView.frame` below,
  /// which drives `sizeChanged`/`onResize`) even before a window exists.
  @objc public func setFrame(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
    let w = max(1, width)
    let h = max(1, height)
    terminalView.frame.size = NSSize(width: w, height: h)
    guard let win = window else { return }
    guard let parent = win.parent ?? parentWindow else {
      win.setFrame(NSRect(x: x, y: y, width: w, height: h), display: true)
      return
    }
    let parentContent = parent.contentRect(forFrameRect: parent.frame)
    let screenX = parentContent.minX + x
    let screenY = parentContent.maxY - y - h
    let full = NSRect(x: screenX, y: screenY, width: w, height: h)
    // Clip to the parent's content area. A DOM tile that overflows the viewport
    // is cropped by the browser; a child NSWindow is cropped by nothing, so
    // without this the overlay paints past the window's edge — measured: a
    // hole reported 3pt taller than the content area poked out of the bottom,
    // and a stale viewport rect re-pushed after a Spectacle re-tile painted a
    // whole tile outside the app. The terminal view keeps its FULL logical
    // size (native is the resize authority — cropping must not change
    // cols/rows); only the window shrinks, and the view is offset inside it so
    // the visible part stays aligned with the hole.
    let visible = full.intersection(parentContent)
    if visible.isNull || visible.width < 1 || visible.height < 1 {
      clippedOut = true
      applyOpacity()
      otrace("setFrame #\(win.windowNumber) viewport=(\(Int(x)),\(Int(y)),\(Int(w)),\(Int(h)))",
             "parentContent=\(parentContent) -> fully outside, clipped out")
      return
    }
    clippedOut = false
    let keyable = win as? KeyableWindow
    keyable?.appliedFrame = visible
    keyable?.applyingFrame = true
    win.setFrame(visible, display: true)
    keyable?.applyingFrame = false
    // AppKit is y-up: a hole hanging below the content area has full.minY <
    // visible.minY, so the view's origin goes negative and its bottom rows
    // fall outside the (cropped) window — exactly the rows the DOM would clip.
    terminalView.frame.origin = NSPoint(x: full.minX - visible.minX, y: full.minY - visible.minY)
    applyOpacity()
    otrace("setFrame #\(win.windowNumber) viewport=(\(Int(x)),\(Int(y)),\(Int(w)),\(Int(h)))",
           "parentFrame=\(parent.frame) parentContent=\(parentContent)",
           "full=\(full) -> window=\(win.frame) viewOrigin=\(terminalView.frame.origin)")
  }

  /// Puts the overlay back where setFrame last put it, if something else moved
  /// it. Idempotent by construction: the restore sets the frame to the value
  /// it compares against, so the notification it triggers finds them equal and
  /// stops.
  private func restoreAppliedFrameIfMovedExternally() {
    guard let w = window as? KeyableWindow, !w.applyingFrame,
          let want = w.appliedFrame, w.frame != want else { return }
    otrace("external frame change on #\(w.windowNumber): \(w.frame) -> restoring \(want)")
    w.applyingFrame = true
    w.setFrame(want, display: true)
    w.applyingFrame = false
  }

  /// Single writer for the window's alpha: painted only when the host wants it
  /// shown AND some of it is inside the parent. show()/hide() and setFrame all
  /// funnel here so the two conditions can never disagree.
  private func applyOpacity() {
    guard let w = window else { return }
    let visible = !hiddenByHost && !clippedOut
    w.alphaValue = visible ? 1 : 0
    w.ignoresMouseEvents = !visible
    (w as? KeyableWindow)?.allowsKey = visible
  }

  // Test seam: the child window's current SCREEN-coordinate frame, after
  // setFrame's conversion. `.zero` when there is no window yet (mirrors
  // debugWindowNumber's -1-for-absent convention).
  public func debugFrame() -> NSRect { window?.frame ?? .zero }
  public func debugTerminalViewFrame() -> NSRect { terminalView.frame }
  public func debugAlpha() -> CGFloat { window?.alphaValue ?? -1 }
  public func debugIgnoresMouseEvents() -> Bool { window?.ignoresMouseEvents ?? false }
  public func debugCanBecomeKey() -> Bool { window?.canBecomeKey ?? false }
  public func debugIsAccessibilityElement() -> Bool { window?.isAccessibilityElement() ?? true }
  public func debugAccessibilityRole() -> NSAccessibility.Role? { window?.accessibilityRole() }
  /// Moves the window the way an external window manager would, then runs the
  /// same restore path the didMove notification drives (notifications do not
  /// deliver synchronously in a unit test).
  public func debugSimulateExternalMove(to rect: NSRect) {
    window?.setFrame(rect, display: false)
    restoreAppliedFrameIfMovedExternally()
  }

  /// Applies Argus's terminal theme to this overlay. `backgroundHex`/
  /// `foregroundHex`/`cursorHex` are "#rrggbb" strings; `ansiHex` is the 16
  /// ANSI colors in xterm order (black, red, green, yellow, blue, magenta,
  /// cyan, white, then the bright variants) — SwiftTerm's
  /// `TerminalView.installColors(_:)` requires exactly 16 or it no-ops, so a
  /// mismatched count here is treated the same way (silently skipped) rather
  /// than partially applying a palette.
  ///
  /// Malformed hex strings for background/foreground/cursor are ignored
  /// individually (each keeps its previous color) rather than aborting the
  /// whole call — a single bad value from JS should not also block the two
  /// good ones next to it.
  ///
  /// SwiftTerm's own NSColor<->Color conversion helpers
  /// (`NSColor.getTerminalColor()`, `NSColor.make(color:)` in
  /// MacExtensions.swift) are internal to the SwiftTerm module and not
  /// visible here, so this file has its own small hex parser and
  /// `Color`-conversion helper below instead of depending on them.
  @objc public func setTheme(backgroundHex: String, foregroundHex: String, cursorHex: String, ansiHex: [String]) {
    if let bg = NSColor(argusHex: backgroundHex) { terminalView.nativeBackgroundColor = bg }
    if let fg = NSColor(argusHex: foregroundHex) { terminalView.nativeForegroundColor = fg }
    if let cursor = NSColor(argusHex: cursorHex) { terminalView.caretColor = cursor }
    guard ansiHex.count == 16 else { return }
    let ansiColors = ansiHex.compactMap { NSColor(argusHex: $0)?.argusTerminalColor() }
    guard ansiColors.count == 16 else { return }
    terminalView.installColors(ansiColors)
  }

  // Test seams — read back what setTheme actually applied.
  public func debugBackgroundColor() -> NSColor { terminalView.nativeBackgroundColor }
  public func debugForegroundColor() -> NSColor { terminalView.nativeForegroundColor }
  public func debugCursorColor() -> NSColor { terminalView.caretColor }

  /// Matches `.argus-tile-overlay` in index.css, which is what an unfocused
  /// xterm tile is painted with. Without it the two engines disagree about
  /// what an unfocused tile looks like: measured against a real screenshot,
  /// an unfocused xterm tile renders #e7e7e6 while a native one stayed at the
  /// theme's #f5f5f5, because the scrim — not the theme — is the difference.
  @objc public func setDimmed(_ dimmed: Bool, isDark: Bool) {
    guard dimmed else {
      dimView?.removeFromSuperview()
      dimView = nil
      return
    }
    let scrim: NSColor = isDark
      ? NSColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.13)
      : NSColor(srgbRed: 20.0 / 255.0, green: 15.0 / 255.0, blue: 8.0 / 255.0, alpha: 0.06)
    if let existing = dimView {
      existing.layer?.backgroundColor = scrim.cgColor
      existing.frame = terminalView.bounds
      return
    }
    let v = PassthroughView(frame: terminalView.bounds)
    v.wantsLayer = true
    v.layer?.backgroundColor = scrim.cgColor
    v.autoresizingMask = [.width, .height]
    terminalView.addSubview(v)
    dimView = v
  }

  @objc public func show() {
    hiddenByHost = false
    guard let w = window else { return }
    otrace("show #\(w.windowNumber) wasVisible=\(w.isVisible) hadParent=\(w.parent != nil)")
    // Normally still a child (hide() no longer detaches), but re-establish the
    // relationship if anything dropped it — an independent window would neither
    // follow the parent nor sit above its content.
    if w.parent == nil, let p = parentWindow {
      p.addChildWindow(w, ordered: .above)
    }
    applyOpacity()
    w.orderFront(nil)
  }

  /// Removing the child from its parent is load-bearing, not tidiness.
  /// `orderOut` alone does NOT keep a child window hidden: AppKit re-orders a
  /// parent's childWindows back in whenever the parent is ordered front, so an
  /// overlay hidden while its tile was off screen reappeared — at its stale
  /// frame — the next time Argus was activated, clicked, or switched to.
  /// destroy() already did this; hide() did not, which is why the host's
  /// visibility state and what was actually on screen could disagree.
  @objc public func hide() {
    hiddenByHost = true
    guard let w = window else { return }
    otrace("hide #\(w.windowNumber) BEFORE visible=\(w.isVisible) parent=\(w.parent?.windowNumber ?? -1)")
    // Measured (CGWindowListCopyWindowInfo, 2026-09-02): after
    // removeChildWindow + orderOut, AppKit reported isVisible == false while
    // the window server still listed this window on screen at its old bounds
    // — and that is exactly what the user saw. Ordering is therefore not
    // something this code can rely on to take a window off screen. Alpha is:
    // the compositor enforces it regardless of ordering state. The window is
    // also made click-through and refused key status, so an invisible overlay
    // can neither eat clicks nor swallow keystrokes.
    applyOpacity()
    if w.isKeyWindow { parentWindow?.makeKey() }
    // Deliberately NOT ordered out or detached. Ordering was measured to be
    // unreliable here, and detaching bought nothing once alpha does the hiding
    // — while staying a child keeps the overlay following the parent and above
    // its content, so show() has nothing to repair.
    otrace("hide #\(w.windowNumber) AFTER  alpha=\(w.alphaValue) parent=\(w.parent?.windowNumber ?? -1)")
    dumpOnScreenWindows("after hide")
    // The synchronous dump can race the window server; a second look settles it.
    if overlayDebug {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { dumpOnScreenWindows("300ms after hide") }
    }
  }
  @objc public func clearScrollback() { terminalView.getTerminal().clearScrollback() }

  /// Search forward or backward for `term`, selecting and scrolling the match
  /// into view. Returns whether a match was found. Drives SwiftTerm's own
  /// search machinery (TerminalViewSearch.swift's findNext/findPrevious,
  /// backed by SearchEngine) rather than reimplementing it. Not exposed to
  /// the addon (see openFindBar/closeFindBar below) — kept as a Swift-level
  /// seam so ShimTests can drive a search without a visible find bar.
  @objc public func search(_ term: String, forward: Bool) -> Bool {
    forward ? terminalView.findNext(term) : terminalView.findPrevious(term)
  }

  /// Clears the current search selection/highlight. Does not touch scrollback.
  @objc public func clearSearch() {
    terminalView.clearSearch()
  }

  /// Opens SwiftTerm's OWN find bar (TerminalFindBarView, embedded as a
  /// subview of the terminal view itself) rather than reusing Argus's DOM
  /// `TerminalSearchBar`. A child NSWindow always paints above the parent's
  /// web content (Phase 2 Gate A) — a DOM search box over a native tile would
  /// render invisibly behind it, and the only way around that without
  /// blanking the tile for the search's duration is to render the box
  /// *inside* the same NSWindow as the terminal. SwiftTerm already ships
  /// exactly that; `performTextFinderAction` is its public, `open` entry
  /// point (the find bar itself — `TerminalFindBarView`/`ensureFindBar()`/
  /// `showFindBar()` — is private to SwiftTerm's own file, not reachable
  /// directly). Idempotent: calling this while already open just refocuses
  /// the search field, which is also the right behavior for a repeated
  /// Cmd+F.
  @objc public func openFindBar() {
    performFindPanelAction(NSTextFinder.Action.showFindInterface)
  }

  /// Closes SwiftTerm's find bar and clears the search highlight/selection.
  /// `performTextFinderAction(.hideFindInterface)` alone only hides the bar —
  /// it does not clear the match state, so `clearSearch()` is called
  /// explicitly to guarantee closing always leaves no stale highlight behind.
  @objc public func closeFindBar() {
    performFindPanelAction(NSTextFinder.Action.hideFindInterface)
    terminalView.clearSearch()
  }

  /// `performTextFinderAction(_:)` (and its sibling `performFindPanelAction`)
  /// only accept an `NSMenuItem` — SwiftTerm reads `.tag`, nothing else off
  /// it, so a throwaway item with no title/action is enough to drive it from
  /// outside as if a Find menu item had been clicked.
  private func performFindPanelAction(_ action: NSTextFinder.Action) {
    let item = NSMenuItem()
    item.tag = action.rawValue
    terminalView.performTextFinderAction(item)
  }

  // Test seam: SwiftTerm's find bar (`TerminalFindBarView`) is a private type
  // inside its own module, and `internal` to SwiftTerm even where it isn't
  // file-private — neither is nameable or reachable from ArgusTerminal. It is
  // publicly known to be an `NSVisualEffectView` subclass though, and nothing
  // else `TerminalView` adds as a direct subview is one, so that's the only
  // externally-visible signal of its presence/visibility.
  public func debugFindBarVisible() -> Bool {
    terminalView.subviews.first(where: { $0 is NSVisualEffectView })?.isHidden == false
  }

  @objc public func destroy() {
    guard let w = window else { return }
    otrace("destroy #\(w.windowNumber)")
    // Same finding as hide(): orderOut alone left destroyed windows painted on
    // screen — each tile remount created a new window and the old one's ghost
    // stayed behind. close() actually tears the window down at the window
    // server; alpha 0 covers the frame until it does. The content view is
    // detached so SwiftTerm's view is not left owned by a dying window.
    w.alphaValue = 0
    w.ignoresMouseEvents = true
    w.parent?.removeChildWindow(w)
    w.orderOut(nil)
    for o in frameObservers { NotificationCenter.default.removeObserver(o) }
    frameObservers = []
    w.contentView = nil
    w.close()
    window = nil
    if overlayDebug {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { dumpOnScreenWindows("300ms after destroy") }
    }
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

/// Own hex <-> color helpers for `setTheme`, deliberately independent of
/// SwiftTerm's internal (module-private) `NSColor.getTerminalColor()` /
/// `NSColor.make(color:)` — see `setTheme`'s doc comment.
private extension NSColor {
  /// Parses a "#rrggbb" (or "rrggbb") string. Returns nil for anything else
  /// — an unrecognized value is treated the same as "no color supplied" by
  /// every call site, which keeps the previous color rather than applying a
  /// crash or a garbage default.
  convenience init?(argusHex hex: String) {
    var s = hex
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
    let r = CGFloat((v >> 16) & 0xFF) / 255.0
    let g = CGFloat((v >> 8) & 0xFF) / 255.0
    let b = CGFloat(v & 0xFF) / 255.0
    self.init(srgbRed: r, green: g, blue: b, alpha: 1.0)
  }

  /// Converts to SwiftTerm's `Color` (16-bit-per-channel RGB) for
  /// `installColors(_:)`. Mirrors the clamping in SwiftTerm's own (private)
  /// `getTerminalColor()` — extended-sRGB round-trips can push components
  /// slightly outside 0...1, and the UInt16 conversion below would trap on
  /// that instead of clamping.
  func argusTerminalColor() -> Color {
    guard let c = usingColorSpace(.sRGB) else { return Color(red: 0, green: 0, blue: 0) }
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    c.getRed(&r, green: &g, blue: &b, alpha: &a)
    func clamp(_ v: CGFloat) -> CGFloat { min(max(v, 0), 1) }
    return Color(red: UInt16(clamp(r) * 65535), green: UInt16(clamp(g) * 65535), blue: UInt16(clamp(b) * 65535))
  }
}
