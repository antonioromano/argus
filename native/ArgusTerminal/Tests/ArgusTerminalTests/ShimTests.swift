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
}
