# Multi-Window Support — Design

Date: 2026-08-25
Status: Approved for planning

## Summary

Argus gains multiple full desktop windows. Each window is a complete Argus
shell (Mosaic/Focus, sidebar, palette) backed by the same in-process server.
Every session belongs to exactly **one** window at a time (exclusive
ownership): the owning window renders it as an expanded tile / focus target;
every other window shows it only as a minimized chip with a window badge.
Sessions move between windows via explicit gestures (context menu, new empty
window, drag tear-off). Window layout and session→window assignment survive
app restarts (full restore).

## Decisions (locked)

| Question | Decision |
|---|---|
| Window model | Multiple full Argus windows, same server |
| Same session in two windows | Never — exclusive ownership |
| Session list per window | Chips for all sessions everywhere; expanded tile only in owner |
| Chip click on foreign-owned session | Focus the owning window; no implicit ownership steal |
| Restart | Full restore: all windows, positions, assignments |
| Closing a secondary window | Its sessions merge back to the main window (as chips); window record deleted |
| Zoom (Cmd +/-/0) | Per window, persisted per window |
| Move gestures | Context menu, File → New Window (empty), drag tear-off (phase 2) |
| Architecture | Server-owned window registry (source of truth), socket broadcast sync |

## 1. Data model + server

### Shared types (`shared/src/types.ts`)

```ts
interface ArgusWindow {
  id: string;        // 'main' for the primary window, crypto.randomUUID() otherwise
  label: string;     // 'Main', 'Window 2', … (renameable later; not in scope)
  isMain: boolean;
  createdAt: number;
}

interface WindowState {
  windows: ArgusWindow[];
  assignments: Record<string, string>; // sessionId → windowId
}
```

- A session absent from `assignments` belongs to the main window (default).
- REST request/response shapes and the `window:state` socket event are added
  to the shared event maps (`ServerToClientEvents`).

### `server/src/persistence/WindowStore.ts`

Atomic-write JSON store (`windows.json` in `ARGUS_DATA_DIR`), same pattern as
`OrderStore`. Invariants enforced on load and on every mutation:

- The `main` window always exists and is never deletable.
- Assignments referencing unknown sessions or unknown windows are pruned.
- Session deletion (SessionManager) removes its assignment.

### Routes (`server/src/routes/windows.ts`)

| Route | Behavior |
|---|---|
| `GET /api/windows` | Full `WindowState` |
| `POST /api/windows` | Create window (optional initial `sessionId` to assign); returns the new window |
| `DELETE /api/windows/:id` | Reassign its sessions to `main`, delete record; 400 on `main` |
| `PUT /api/windows/assign` | `{ sessionId, windowId }` — move one session |
| `POST /api/windows/:id/merge-all` | Assign every session to `:id`; delete every other window record that ends up empty (main is kept even when empty) |

All routes behind the existing auth middleware, same as other API routes.

### Sync

Every mutation broadcasts `window:state` (full snapshot — small payload,
avoids delta bookkeeping) to all connected clients. The Electron main process
receives the same state via injected callbacks (§2), not a socket.

## 2. Electron main process

### `window.ts` → `WindowManager`

The module-level singleton (`win`, `currentZoomLevel`) becomes a manager over
`Map<windowId, BrowserWindow>`:

- Each BrowserWindow loads `http://127.0.0.1:PORT/?windowId=<id>`.
- Per-window persisted state: bounds, displayId, fullscreen, zoomLevel —
  stored keyed by windowId in `window-state.json`. Migration: a legacy
  single-object file is read as the `main` window's state.
- Startup: after `server.startServer()`, main reads the window registry via
  an injected getter and opens one BrowserWindow per stored window.
- Zoom: tracked per window; menu items act on the focused window.

### Server ⇄ main coordination

Injected callbacks, matching the existing `setPickFolderFn` pattern:

```ts
server.setWindowHooks({
  onCreate(id): void   // open BrowserWindow for a newly created window record
  onClose(id): void    // close BrowserWindow after a window record is deleted
  onFocus(id): void    // show + focus a window (chip click, notif click)
});
// plus a getter used at startup: server.getWindowState()
```

No socket.io client in the main process.

### Close/quit semantics

- **Secondary window close (red button)**: real close. Main intercepts it,
  calls the server delete (sessions merge to main), then destroys the
  BrowserWindow.
- **Main window close**: unchanged — hide window + dock icon, app stays
  alive. Secondary windows keep working if open.
- **Quit** (`before-quit`): unchanged flow; `saveWindowState()` iterates all
  windows so every window's bounds/zoom persist.

### Menu / IPC retargeting

- `sendMenuEvent` → `BrowserWindow.getFocusedWindow()` (fallback: main).
- `deliverNotifClick(sessionId)` → resolve owning window from server state,
  focus that window, send `notif:click` to it.
- `dialog:showMessageBox` already resolves the window from `event.sender` —
  no change.
- Menu additions: `File → New Window` (Cmd+Shift+N), `Window → Merge All
  Windows`.
- `dock:setBadge`: only the main window's renderer sends it (renderer-side
  guard) so N windows don't fight over the badge.

### Preload

Unchanged. `windowId` travels in the URL.

## 3. Client / renderer

### Window identity

`windowId` read from the URL query at boot; defaults to `main`. `dev:web`
and `/mobile` therefore behave as the main window with zero changes.

### `hooks/useWindows.ts`

Fetches `GET /api/windows`, subscribes to `window:state`. Exposes
`myWindowId`, `windows`, `ownerOf(sessionId)`, and actions
(`moveToWindow`, `moveToNewWindow`, `mergeAllHere`, `focusWindow`).

### Ownership → visibility

- Owned by this window → existing tile/minimize/focus behavior, untouched.
- Owned elsewhere → forced into the chip row; chip renders a window badge
  (e.g. "W2"); chip click calls `focusWindow(ownerId)` — never steals.
- Implementation: `useMosaicVisibility.isMinimized()` gains an ownership
  check as its first clause. The `mosaic-minimized` localStorage key becomes
  `mosaic-minimized:<windowId>` so windows stop sharing hand-minimize state.

### Move gestures

1. **Context menu** (`sessionMenu.ts`): "Move to New Window",
   "Move to <window label>…" submenu, "Merge All Windows Here".
2. **File → New Window**: creates an empty window; all sessions appear as
   chips; user expands nothing until sessions are moved there.
3. **Drag tear-off** (phase 2): during a tile drag, pointer leaving the
   window bounds triggers `moveToNewWindow(sessionId)`. @dnd-kit has no
   cross-window support, so this is drag-out detection, not a live drag
   preview.

### State scoping

- Per window (naturally, React state): focus-mode session, active group
  filter, palette, overlays.
- Per window (persisted): minimized set (localStorage keyed by windowId),
  zoom (Electron side).
- Global (unchanged): theme, config, session order, groups.

### Terminal correctness

Exclusive ownership means exactly one window mounts a session's xterm, so
exactly one client drives the pty size — no resize-storm exposure. One
socket connection per window is the already-supported multi-client path
(mobile precedent); tmux capture-pane replay on join covers a session
arriving in a new window.

## Error handling

- Move to a window deleted in a race → server responds 404; client refetches
  `window:state` and re-renders (assignment unchanged).
- BrowserWindow crash/kill without DELETE → on next `window:state` read at
  startup, windows restore; mid-session, a renderer gone dark leaves the
  record intact and the window can be refocused/reopened via merge actions.
- `windows.json` corrupt/missing → store resets to `{ main }`, all sessions
  fall back to main (default-assignment rule makes this safe).

## Testing

- **Server** (`node:test`): WindowStore invariants (main survival, pruning,
  merge-back on delete), route behaviors including merge-all and 400 on
  deleting main.
- **Client** (Vitest): `useWindows` state/actions; ownership clause in
  `useMosaicVisibility`; chip badge/click routing.
- **Manual smoke**: two windows in `npm run dev` and packaged build — move,
  merge, close-secondary, restart-restore, notification click routing to the
  owning window.

## Phasing

- **Phase 1**: everything above except drag tear-off.
- **Phase 2**: drag tear-off gesture.

## Out of scope

- Window renaming UI.
- Cross-window live drag preview.
- Mobile/companion changes.
- Any change to session lifecycle, pty, or state detection.
