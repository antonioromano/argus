/**
 * Which window a menu command (reload, zoom, the sendMenuEvent family) acts on.
 *
 * `BrowserWindow.getFocusedWindow()` is null while a native terminal tile has
 * keyboard focus: the tile is a borderless child NSWindow (OverlayController's
 * KeyableWindow), not a BrowserWindow, and it — not the Electron window — is
 * the key window. Built-in roles such as `reload` target the focused window, so
 * Cmd+R silently did nothing with a native tile focused, and every custom item
 * fell back to the MAIN window even when the tile lived in a second window.
 *
 * Order: the window with OS focus, else the window hosting the key native
 * overlay, else null (the caller falls back to the main window).
 */
export function resolveMenuTarget<W>(
  focused: W | null,
  keyOverlayOwners: Iterable<W | null | undefined>,
): W | null {
  if (focused) return focused;
  for (const w of keyOverlayOwners) if (w) return w;
  return null;
}
