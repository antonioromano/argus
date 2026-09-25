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

  /// The host reads the grid straight after setFrame to size the replay seed,
  /// so it must already match what onResize reports — no deferral.
  func testGridSizeIsCurrentImmediatelyAfterSetFrame() {
    let c = OverlayController(width: 800, height: 480)
    var reported: (Int, Int)?
    c.onResize = { cols, rows in reported = (cols, rows) }
    c.setFrame(x: 0, y: 0, width: 400, height: 240)
    XCTAssertNotNil(reported)
    XCTAssertEqual(c.gridCols, reported!.0)
    XCTAssertEqual(c.gridRows, reported!.1)
  }

  func testUserInputReachesTheCallback() {
    let c = OverlayController(width: 800, height: 480)
    var got = Data()
    c.onInput = { data in got = data as Data }
    c.simulateInput("ls -la\r")
    XCTAssertEqual(String(decoding: got, as: UTF8.self), "ls -la\r")
  }

  /// SwiftTerm defaults to 500 lines; xterm keeps 5000, and the replay seed
  /// carries the mirror's full history — anything past the limit is dropped.
  func testScrollbackCanBeRaisedToMatchXterm() {
    let c = OverlayController(width: 800, height: 480)
    c.setScrollback(5000)
    XCTAssertEqual(c.debugScrollbackLimit(), 5000)
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

  /// Keyboard focus is how SwiftTerm receives input, so presenting the
  /// overlay to the AX API as a group rather than a window must not cost that.
  func testTheAccessibilityGroupKeepsKeyEligibility() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.show()

    XCTAssertTrue(c.debugCanBecomeKey())
  }

  func testAnExternalFrameChangeIsUndone() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
                          styleMask: [.borderless], backing: .buffered, defer: false)
    c.attach(to: parent)
    c.show()
    c.setFrame(x: 10, y: 20, width: 300, height: 200)
    let applied = c.debugFrame()

    // What a window manager does: move the window directly.
    c.debugSimulateExternalMove(to: NSRect(x: 400, y: 400, width: 300, height: 200))

    XCTAssertEqual(c.debugFrame(), applied, "the overlay must return to the hole it belongs to")
  }

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

  /// The scrim's alpha is paired BY HAND with `.argus-tile-overlay` in
  /// index.css. It is the only signal of which tile is selected, so a drift
  /// makes native tiles stop matching their neighbours — which is exactly
  /// what happened before the native scrim existed. Pinned here; if these
  /// fail, index.css changed and this must follow (or vice versa).
  func testDimScrimAlphaMatchesTheStylesheet() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)

    c.setDimmed(true, isDark: true)
    XCTAssertEqual(c.debugDimAlpha(), 0.22, accuracy: 0.001, "dark: rgba(0, 0, 0, 0.22)")

    c.setDimmed(true, isDark: false)
    XCTAssertEqual(c.debugDimAlpha(), 0.13, accuracy: 0.001, "light: rgba(20, 15, 8, 0.13)")

    c.setDimmed(false, isDark: false)
    XCTAssertEqual(c.debugDimAlpha(), -1, "and clearing it removes the scrim entirely")
  }

  /// Shift+Enter is not a terminal capability — Argus translates it to ESC CR
  /// so Claude Code inserts a newline instead of submitting. The xterm path
  /// does this in its own key handler; without the same translation here
  /// SwiftTerm sent a bare CR and the prompt was submitted.
  func testShiftReturnSendsEscapeCarriageReturn() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    var sent: [[UInt8]] = []
    c.onInput = { data in sent.append([UInt8](data as Data)) }

    c.debugSendKey(keyCode: 36, flags: [.shift])

    XCTAssertEqual(sent, [[0x1b, 0x0d]], "ESC CR, the sequence the xterm path sends")
  }

  func testKeypadShiftEnterAlsoSendsIt() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    var sent: [[UInt8]] = []
    c.onInput = { data in sent.append([UInt8](data as Data)) }

    c.debugSendKey(keyCode: 76, flags: [.shift])

    XCTAssertEqual(sent, [[0x1b, 0x0d]], "the xterm path matches on key === 'enter', which covers the keypad")
  }

  /// Plain Return must still submit, and other modifier combinations belong to
  /// other bindings — swallowing them here would break them silently.
  func testOtherReturnCombinationsAreNotIntercepted() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    var sent: [[UInt8]] = []
    c.onInput = { data in sent.append([UInt8](data as Data)) }

    c.debugSendKey(keyCode: 36, flags: [])                    // plain Return
    c.debugSendKey(keyCode: 36, flags: [.shift, .command])    // Cmd+Shift+Return
    c.debugSendKey(keyCode: 36, flags: [.shift, .option])     // Opt+Shift+Return
    c.debugSendKey(keyCode: 36, flags: [.shift, .control])    // Ctrl+Shift+Return

    XCTAssertEqual(sent, [], "none of these are the newline binding")
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

  /// SwiftTerm paints whole cells and reserves scroller width, so a few points
  /// along the right and bottom are never painted by the grid. Whatever is
  /// behind must be the same colour or those points read as a different
  /// background — measured as three greys in one tile.
  func testSetThemePaintsTheWindowAndContainerBehindTheGrid() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)

    c.setTheme(backgroundHex: "#f5f5f5", foregroundHex: "#343b58", cursorHex: "#343b58",
               ansiHex: Array(repeating: "#000000", count: 16))

    let v: CGFloat = 245.0 / 255.0
    let want = NSColor(srgbRed: v, green: v, blue: v, alpha: 1).argusRGBA()
    XCTAssertEqual(c.debugBackgroundColor().argusRGBA(), want, "the grid's own background")
    XCTAssertEqual(c.debugWindowBackgroundColor()?.argusRGBA(), want, "and the window behind it")
    let container = c.debugContainerBackgroundColor()
    XCTAssertNotNil(container)
    XCTAssertEqual(NSColor(cgColor: container!)?.argusRGBA(), want, "and the container the view sits in")
  }

  /// SwiftTerm's scroll indicator draws its own track and reserves width the
  /// grid never paints — measured as two extra greys down the right edge of a
  /// tile. It is non-interactive anyway, and xterm tiles show no scrollbar.
  func testTheScrollIndicatorIsHidden() {
    let c = OverlayController(width: 200, height: 100)

    XCTAssertEqual(c.debugVisibleScrollerCount(), 0, "no scroller may be visible on init")

    c.setFrame(x: 0, y: 0, width: 300, height: 200)
    XCTAssertEqual(c.debugVisibleScrollerCount(), 0, "and it must not come back on a resize")
  }





  /// Argus switches theme instantly — no view transition, no colour
  /// transitions. The overlay must too: a child NSWindow is not part of a DOM
  /// snapshot, so any animation here is independent of the app's and was
  /// visibly out of step with it.
  func testAThemeChangeIsAppliedInstantly() {
    let c = OverlayController(width: 200, height: 100)
    let parent = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                          styleMask: [.titled], backing: .buffered, defer: false)
    c.attach(to: parent)
    let ansi = Array(repeating: "#000000", count: 16)
    c.setTheme(backgroundHex: "#f5f5f5", foregroundHex: "#343b58", cursorHex: "#343b58", ansiHex: ansi)

    c.setTheme(backgroundHex: "#1a1b26", foregroundHex: "#c0caf5", cursorHex: "#c0caf5", ansiHex: ansi)

    XCTAssertEqual(c.debugBackgroundColor().argusHexString(), "#1a1b26")
    XCTAssertEqual(c.debugForegroundColor().argusHexString(), "#c0caf5")
    XCTAssertEqual(c.debugCursorColor().argusHexString(), "#c0caf5")
    // And behind the grid, or the sub-cell gutter keeps the old colour.
    XCTAssertEqual(c.debugWindowBackgroundColor()?.argusHexString(), "#1a1b26")
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

  /// The font must follow Argus's code font size; SwiftTerm's default is 13pt
  /// regardless of the setting. A bigger font means fewer columns.
  func testFontSizeChangesTheGrid() {
    let c = OverlayController(width: 800, height: 480)
    c.setFrame(x: 0, y: 0, width: 800, height: 480)
    let colsAt13 = c.gridCols
    c.setFontSize(26)
    XCTAssertLessThan(c.gridCols, colsAt13)
  }

  /// SwiftTerm's font setter always resizes (reporting via onResize) and
  /// soft-resets the terminal, even for the size it already has. The host
  /// re-sends the same size after every attach, so re-applying it would reset
  /// modes the seed just set — e.g. show a cursor the agent hid.
  func testSettingTheCurrentFontSizeIsANoOp() {
    let c = OverlayController(width: 800, height: 480)
    c.setFrame(x: 0, y: 0, width: 800, height: 480)
    c.setFontSize(15)
    let cols = c.gridCols, rows = c.gridRows
    c.feed(data: Data("\u{1b}[?25l".utf8) as NSData)
    var reported = false
    c.onResize = { _, _ in reported = true }

    c.setFontSize(15)

    XCTAssertFalse(reported)
    XCTAssertEqual(c.gridCols, cols)
    XCTAssertEqual(c.gridRows, rows)
    XCTAssertTrue(cursorIsHidden(c), "a no-op must not soft-reset the terminal")
  }

  /// DECTCEM state via DECRQM (`CSI ? 25 $ p` -> `CSI ? 25 ; 2 $ y` when
  /// reset): SwiftTerm keeps `cursorHidden` internal, so ask the terminal.
  private func cursorIsHidden(_ c: OverlayController) -> Bool {
    var reply = Data()
    let saved = c.onInput
    c.onInput = { reply.append($0 as Data) }
    c.feed(data: Data("\u{1b}[?25$p".utf8) as NSData)
    c.onInput = saved
    return String(decoding: reply, as: UTF8.self).contains("?25;2$y")
  }

  func testNonFiniteOrNonPositiveFontSizesAreIgnored() {
    let c = OverlayController(width: 800, height: 480)
    c.setFrame(x: 0, y: 0, width: 800, height: 480)
    let before = c.debugFontPointSize()
    for bad: CGFloat in [0, -3, .nan, .infinity, -.infinity] {
      c.setFontSize(bad)
      XCTAssertEqual(c.debugFontPointSize(), before, "\(bad)")
    }
  }

  func testFontSizeIsClampedToASaneRange() {
    let c = OverlayController(width: 800, height: 480)
    c.setFontSize(1)
    XCTAssertEqual(c.debugFontPointSize(), 6)
    c.setFontSize(500)
    XCTAssertEqual(c.debugFontPointSize(), 72)
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
