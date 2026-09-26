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
