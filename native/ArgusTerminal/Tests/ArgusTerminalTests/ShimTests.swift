import AppKit
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

  func testOverlayWindowCanBecomeKey() {
    // Without this the overlay accepts no keyboard input at all. Regression
    // guard: a plain borderless NSWindow returns false here.
    let w = KeyableWindow(contentRect: NSRect(x: 0, y: 0, width: 10, height: 10),
                          styleMask: [.borderless], backing: .buffered, defer: false)
    XCTAssertTrue(w.canBecomeKey)
    XCTAssertFalse(w.canBecomeMain)
  }

  func testClearScrollbackKeepsTheVisibleScreen() {
    let c = OverlayController(width: 800, height: 480)
    for i in 0..<200 { c.feed(data: Data("line \(i)\r\n".utf8) as NSData) }
    let before = c.debugRow(0)
    c.clearScrollback()
    XCTAssertEqual(c.debugRow(0), before)
  }

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

  /// AppKit re-orders a parent's childWindows in whenever the parent is
  /// ordered front, and ordering a former child out proved unreliable at the
  /// window-server level. Hiding is therefore done by alpha, which no
  /// re-ordering can undo — and the overlay stays a child so it keeps
  /// following the parent.
  func testHideSurvivesTheParentBeingOrderedFront() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.show()
    XCTAssertEqual(c.debugAlpha(), 1)

    c.hide()
    parent.orderFront(nil)

    XCTAssertEqual(c.debugAlpha(), 0, "ordering the parent front must not make it visible")
    XCTAssertEqual(c.debugParentWindowNumber(), parent.windowNumber, "and it stays a child")
  }

  func testShowKeepsTheParentRelationship() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.hide()

    c.show()

    XCTAssertEqual(c.debugParentWindowNumber(), parent.windowNumber,
                   "show must never leave a free-floating window")
  }

  func testReparentWhileHiddenDoesNotRevealTheOverlay() {
    let c = OverlayController(width: 200, height: 100)
    let a = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                     styleMask: [.titled], backing: .buffered, defer: false)
    let b = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                     styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: a)
    c.hide()

    c.reparent(to: b)

    XCTAssertEqual(c.debugAlpha(), 0, "moving a hidden session between windows must not show its overlay")
    XCTAssertEqual(c.debugParentWindowNumber(), b.windowNumber, "but it must now belong to the NEW parent")
    c.show()
    XCTAssertEqual(c.debugAlpha(), 1)
    XCTAssertEqual(c.debugParentWindowNumber(), b.windowNumber)
  }

  /// setFrame converts against the parent's content rect, and a hidden overlay
  /// has no `window.parent` to read it from — without the tracked reference it
  /// would silently treat viewport coordinates as screen coordinates.
  func testSetFrameStillConvertsWhileHidden() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 500, y: 400, width: 800, height: 600),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.hide()

    c.setFrame(x: 10, y: 20, width: 300, height: 150)

    let content = parent.contentRect(forFrameRect: parent.frame)
    XCTAssertEqual(c.debugFrame().origin.x, content.minX + 10, accuracy: 0.5)
    XCTAssertEqual(c.debugFrame().origin.y, content.maxY - 20 - 150, accuracy: 0.5)
  }

  /// Ordering proved unreliable for taking a window off screen (see hide()'s
  /// comment), so alpha is what actually hides it — and an invisible window
  /// must not be able to take clicks or keyboard focus either.
  func testHideMakesTheWindowTransparentClickThroughAndNotKeyable() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)

    c.hide()

    XCTAssertEqual(c.debugAlpha(), 0)
    XCTAssertTrue(c.debugIgnoresMouseEvents())
    XCTAssertFalse(c.debugCanBecomeKey(), "an invisible overlay must not swallow keystrokes")
  }

  func testShowRestoresOpacityClicksAndKeyability() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.hide()

    c.show()

    XCTAssertEqual(c.debugAlpha(), 1)
    XCTAssertFalse(c.debugIgnoresMouseEvents())
    XCTAssertTrue(c.debugCanBecomeKey())
  }

  func testDestroyClosesTheWindowAndReleasesTheReference() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    XCTAssertNotEqual(c.debugWindowNumber(), -1)

    c.destroy()

    XCTAssertEqual(c.debugWindowNumber(), -1, "the controller must drop its window")
    XCTAssertFalse(parent.childWindows?.isEmpty == false, "and the parent must not still list it")
  }

  /// addChildWindow orders the child in immediately, so an overlay that did
  /// not start hidden was on screen from creation at its construction size —
  /// and the host, believing a fresh overlay is not shown, never hid it.
  func testAFreshOverlayIsNotVisibleUntilShown() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)

    c.attach(to: parent)

    XCTAssertEqual(c.debugAlpha(), 0, "must not be painted before show()")
    XCTAssertTrue(c.debugIgnoresMouseEvents())
    XCTAssertFalse(c.debugCanBecomeKey())

    c.show()
    XCTAssertEqual(c.debugAlpha(), 1)
  }

  /// The measured case: a hole reported 3pt taller than the parent's content
  /// area. The browser clips the DOM tile; the window must be clipped the same
  /// way — while the terminal keeps its full logical size so cols/rows do not
  /// change (native is the resize authority).
  func testSetFrameClipsAHoleHangingBelowTheContentArea() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 100, y: 200, width: 800, height: 600),
                          styleMask: [.borderless], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.show()
    let content = parent.contentRect(forFrameRect: parent.frame)

    // y=20 from the top, 583 tall -> bottom at viewport y=603, 3pt past 600.
    c.setFrame(x: 10, y: 20, width: 300, height: 583)

    let win = c.debugFrame()
    XCTAssertEqual(win.minY, content.minY, accuracy: 0.5, "window bottom must stop at the content bottom")
    XCTAssertEqual(win.height, 580, accuracy: 0.5, "3pt of overhang cropped")
    let view = c.debugTerminalViewFrame()
    XCTAssertEqual(view.height, 583, accuracy: 0.5, "the terminal keeps its full logical height")
    XCTAssertEqual(view.origin.y, -3, accuracy: 0.5, "and is shifted so its bottom 3pt fall outside the window")
    XCTAssertEqual(c.debugAlpha(), 1)
  }

  func testSetFrameClipsAHoleOffTheRightEdge() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
                          styleMask: [.borderless], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.show()

    // A stale rect from before a Spectacle shrink: x=700 in an 800-wide window.
    c.setFrame(x: 700, y: 20, width: 300, height: 200)

    let win = c.debugFrame()
    XCTAssertEqual(win.maxX, 800, accuracy: 0.5, "must not paint past the window's right edge")
    XCTAssertEqual(win.width, 100, accuracy: 0.5)
    XCTAssertEqual(c.debugTerminalViewFrame().width, 300, accuracy: 0.5, "logical width unchanged")
    XCTAssertEqual(c.debugTerminalViewFrame().origin.x, 0, accuracy: 0.5, "left edge is inside, no x offset")
  }

  func testAHoleEntirelyOutsideTheParentIsNotPainted() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
                          styleMask: [.borderless], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.show()
    XCTAssertEqual(c.debugAlpha(), 1)

    c.setFrame(x: 1043, y: 20, width: 453, height: 300)   // the Spectacle case, verbatim
    XCTAssertEqual(c.debugAlpha(), 0, "nothing of it is inside the window")

    c.setFrame(x: 10, y: 20, width: 300, height: 200)
    XCTAssertEqual(c.debugAlpha(), 1, "and it comes back once the hole is inside again")
  }

  func testClippedOutDoesNotOverrideAHostHide() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.hide()

    c.setFrame(x: 10, y: 20, width: 300, height: 200)   // inside, but host says hidden

    XCTAssertEqual(c.debugAlpha(), 0, "a frame inside the parent must not reveal a host-hidden overlay")
  }

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

  func testOpenFindBarShowsSwiftTermsOwnFindBar() {
    let c = OverlayController(width: 400, height: 200)
    XCTAssertFalse(c.debugFindBarVisible(), "no find bar until opened")
    c.openFindBar()
    XCTAssertTrue(c.debugFindBarVisible())
  }

  func testCloseFindBarHidesItAndIsSafeWithoutAPriorSearch() {
    let c = OverlayController(width: 400, height: 200)
    c.openFindBar()
    XCTAssertTrue(c.debugFindBarVisible())
    c.closeFindBar()
    XCTAssertFalse(c.debugFindBarVisible())
  }

  func testOpenFindBarIsIdempotent() {
    // A second Cmd+F while already open must re-focus, not create a second bar.
    let c = OverlayController(width: 400, height: 200)
    c.openFindBar()
    c.openFindBar()
    XCTAssertTrue(c.debugFindBarVisible())
  }

  // MARK: - setFrame coordinate conversion (Bug 1)

  func testSetFrameConvertsViewportRectToScreenCoordinatesAgainstNonOriginParent() {
    // The parent window is deliberately NOT at the screen origin. An
    // origin-only test would pass even with the `parentContent.minX`/
    // `parentContent.maxY` offset missing entirely (0 + x == x by
    // coincidence), which is exactly the bug this guards against.
    let parent = NSWindow(contentRect: NSRect(x: 300, y: 150, width: 1000, height: 700),
                          styleMask: [.titled, .resizable], backing: .buffered, defer: false)
    let c = OverlayController(width: 200, height: 100)
    c.attach(to: parent)

    // Viewport rect: 40px in from the left edge of the web content, 60px
    // down from its top (e.g. a tile whose header occupies the top 60px).
    c.setFrame(x: 40, y: 60, width: 300, height: 200)

    let parentContent = parent.contentRect(forFrameRect: parent.frame)
    let expected = NSRect(x: parentContent.minX + 40,
                          y: parentContent.maxY - 60 - 200,
                          width: 300, height: 200)
    let got = c.debugFrame()
    XCTAssertEqual(got.origin.x, expected.origin.x, accuracy: 0.5)
    XCTAssertEqual(got.origin.y, expected.origin.y, accuracy: 0.5)
    XCTAssertEqual(got.size.width, expected.size.width, accuracy: 0.5)
    XCTAssertEqual(got.size.height, expected.size.height, accuracy: 0.5)
  }

  func testSetFrameYAxisIsFlippedNotJustOffset() {
    // A viewport rect flush with the top of the content (y: 0) must land at
    // the TOP of the parent's screen-coordinate content rect (maxY - height),
    // not the bottom (minY) — proving the flip direction, not just that some
    // offset was added.
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
                          styleMask: [.titled, .resizable], backing: .buffered, defer: false)
    let c = OverlayController(width: 100, height: 50)
    c.attach(to: parent)

    c.setFrame(x: 0, y: 0, width: 100, height: 50)

    let parentContent = parent.contentRect(forFrameRect: parent.frame)
    let got = c.debugFrame()
    XCTAssertEqual(got.origin.y, parentContent.maxY - 50, accuracy: 0.5)
    XCTAssertNotEqual(got.origin.y, parentContent.minY, "a viewport y of 0 must map near the TOP of the parent, not the bottom")
  }

  func testSetFrameWithNoParentStillResizesTheGrid() {
    // setFrame is called (for grid sizing) before attach() in some paths —
    // must not crash, and the terminal grid must still resize.
    let c = OverlayController(width: 800, height: 480)
    var reported: (Int, Int)?
    c.onResize = { cols, rows in reported = (cols, rows) }
    c.setFrame(x: 0, y: 0, width: 400, height: 240)
    XCTAssertNotNil(reported)
  }

  // MARK: - setTheme (Bug 2)

  func testSetThemeAppliesBackgroundForegroundAndCursor() {
    let c = OverlayController(width: 400, height: 200)
    c.setTheme(backgroundHex: "#1a1b26", foregroundHex: "#c0caf5", cursorHex: "#ff0000",
              ansiHex: Array(repeating: "#000000", count: 16))

    XCTAssertEqual(c.debugBackgroundColor().argusHexString(), "#1a1b26")
    XCTAssertEqual(c.debugForegroundColor().argusHexString(), "#c0caf5")
    XCTAssertEqual(c.debugCursorColor().argusHexString(), "#ff0000")
  }

  func testSetThemeIgnoresMalformedHexAndKeepsThePreviousColor() {
    let c = OverlayController(width: 400, height: 200)
    c.setTheme(backgroundHex: "#111111", foregroundHex: "#222222", cursorHex: "#333333",
              ansiHex: Array(repeating: "#000000", count: 16))
    // A malformed background must not clobber the good value set above, and
    // must not stop the (valid) foreground/cursor in the same call from applying.
    c.setTheme(backgroundHex: "not-a-color", foregroundHex: "#444444", cursorHex: "#555555",
              ansiHex: Array(repeating: "#000000", count: 16))

    XCTAssertEqual(c.debugBackgroundColor().argusHexString(), "#111111")
    XCTAssertEqual(c.debugForegroundColor().argusHexString(), "#444444")
    XCTAssertEqual(c.debugCursorColor().argusHexString(), "#555555")
  }

  func testSetThemeWithWrongAnsiCountSkipsThePaletteButStillAppliesTheRest() {
    let c = OverlayController(width: 400, height: 200)
    // Only 3 entries instead of 16 — must not crash, and background/
    // foreground/cursor (independent of the palette) must still apply.
    c.setTheme(backgroundHex: "#0f0f0f", foregroundHex: "#e0e0e0", cursorHex: "#e0e0e0",
              ansiHex: ["#000000", "#ffffff"])
    XCTAssertEqual(c.debugBackgroundColor().argusHexString(), "#0f0f0f")
  }
}

private extension NSColor {
  /// Test-only round-trip helper: renders back to "#rrggbb" so assertions can
  /// compare against the hex strings the tests fed into `setTheme`.
  func argusHexString() -> String {
    guard let c = usingColorSpace(.sRGB) else { return "#000000" }
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    c.getRed(&r, green: &g, blue: &b, alpha: &a)
    func byte(_ v: CGFloat) -> Int { Int((v * 255).rounded()) }
    return String(format: "#%02x%02x%02x", byte(r), byte(g), byte(b))
  }
}
