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
