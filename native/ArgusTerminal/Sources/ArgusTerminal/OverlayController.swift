import AppKit
import SwiftTerm

/// A borderless NSWindow returns `canBecomeKey == false` by default, so it can
/// never take keyboard focus and the terminal inside it receives nothing. This
/// override is load-bearing — verified during Gate B, where a plain
/// `NSWindow(styleMask: [.borderless])` reported `canBecomeKey: false`.
/// `canBecomeMain` stays false so the Electron window remains the main window.
final class KeyableWindow: NSWindow {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

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
