# Native Terminal Engine — Phase 1 End-to-End Smoke

Task 7 of the Phase 1 implementation plan. No automated coverage exists for
pixels or real window layering, so this is the manual/semi-automated gate
that closes Phase 1. Everything below was run against a real, unpackaged dev
build of Argus (Node 24, `ARGUS_PORT` forced to `5403` in dev mode, tmux
socket `argus-dev`, userData `.../Library/Application Support/argus-dev`) —
never the installed app (`/Applications/Argus.app`, PID 62995, port 5757),
which was left running and untouched throughout, alongside its `argusd`
daemon (PID 37560).

Screenshots are unavailable in this environment (the shell descends from a
daemon that predates the Screen Recording grant), so visual claims below are
either verified without pixels (via `CGWindowListCopyWindowInfo`, which needs
no capture permission) or explicitly deferred to a human.

## Gates A and B

Already closed and recorded in the design spec prior to this task:
- Gate A (z-order): `docs/superpowers/specs/2026-08-28-native-terminal-engine-design.md` — commit `c9a53d7`.
- Gate B: closed as accepted risk — commit `f110382`.

## Green-gate commands (Definition of Done)

All run on Node 24.16.0 (`nvm use 24`), from a clean working tree, flag unset
(default build — the "current app" baseline):

| Command | Result |
|---|---|
| `npm run lint -w client` | **PASS** — 0 problems |
| `npm run build:all` | **PASS** — exit 0 (shared → server → client → electron) |
| `npm test` (server + client) | **PASS** — server 393/394 (1 skipped, 0 failed), client 279/279 |
| `swift test` (`native/ArgusTerminal`) | **PASS** — 5/5 (`ShimTests`) |

## Checklist results

### 1. Create a Claude session, open Focus. Terminal renders in SwiftTerm.

**PARTIAL — architecture proven, pixel rendering NEEDS-HUMAN.**

- Rebuilt with `VITE_ARGUS_NATIVE_TERM=1 npm run build:all`, booted with
  `ARGUS_NATIVE_TERM=1 npx electron --remote-debugging-port=9333 .`.
- Log showed no `[native-term] addon unavailable` warning (the only thing
  `loadNativeTerminalAddon` logs on failure), server up on `127.0.0.1:5403`.
- Confirmed via CDP (`Runtime.evaluate` against the real renderer):
  `window.electronNativeTerminal.available()` → `true`.
- Created a real session via `POST /api/sessions` (`folderPath:
  /Users/macbookpro10/development/projects/argus, agentType: claude, name:
  task7-smoke-test`) → id `1f121d9d-e224-4849-b332-ccd61add782d`.
- Called `window.electronNativeTerminal.attach('1f121d9d-...', {x:100,
  y:100, width:600, height:400})` via CDP (the same IPC channel the real
  `useNativeOverlayRect` hook calls from Focus). Confirmed via
  `CGWindowListCopyWindowInfo` (no Screen Recording permission needed) that a
  **new on-screen window appeared**, owned by the Electron process, at
  exactly the requested geometry:
  ```
  before: num=29721 layer=0 bounds={Width:1400 Height:856 X:56 Y:38}   <- main app window only
  after:  num=29730 layer=0 bounds={Width:600  Height:400 X:100 Y:482} <- new overlay window
          num=29721 layer=0 bounds={Width:1400 Height:856 X:56 Y:38}   <- main app window, unchanged
  ```
- No `[native-term]` error lines appeared in the log across create/setFrame/show/replay-seed-feed.
- Detached the overlay (`electronNativeTerminal.detach(...)`) and confirmed via the same
  window list that window `29730` disappeared, leaving only the main window.
- **What this proves:** the full attach/create/setFrame/show/detach/destroy lifecycle works
  against the real addon and a real session, with no errors, exactly matching the geometry requested.
- **What this does NOT prove (NEEDS-HUMAN):** that SwiftTerm is actually drawing legible glyphs,
  correct colors, and a visible cursor inside that window — no screenshot capability in this
  environment. A human must open Focus with the flag on and look at it.

### 2. Type — input reaches the agent; output streams back.

**PASS** (proven via the session used in item 5's simultaneous test, see below —
a real `echo TASK7_MARKER_<timestamp>` was sent over `session:input` and the
timestamped marker came back over `session:output`, i.e. the agent actually
received and echoed it). Whether it also *displays* correctly inside the
native window — NEEDS-HUMAN (same screenshot limitation).

### 3. Resize the window — grid reflows, no duplicated transcript.

**NEEDS-HUMAN.** This is a visual/geometry-feel check (dragging window edges,
watching the SwiftTerm content reflow without artifacts). `useNativeOverlayRect`'s
`ResizeObserver`-driven `setRect` plumbing is unit-tested (task 6, 8 tests) and the
resize IPC path (`native-term:rect` → `NativeTerminalHost.setRect` → `addon.setFrame`)
is exercised above (item 1's geometry match), but "no duplicated transcript" on an
actual live resize needs a human watching the screen.

### 4. Scroll with the wheel — scrollback works.

**NEEDS-HUMAN.** Pure UX/feel; no automated proxy attempted. (Note: the existing
`argus-tmux-wheel-forward` xterm.js codepath is unrelated to the native engine —
SwiftTerm has its own scrollback and wheel handling inside the addon, untested here.)

### 5. Attach from a phone over ngrok while native is open — the phone shows the same session in xterm.js, both live. Core architectural claim.

**PASS (substituted a headless socket.io client for the literal phone — approved
substitution; see brief's own instruction and safety constraints, which flagged
screenshots/physical-device driving as unavailable in this environment).**

With the native overlay still attached (window `29730`, from item 1) to session
`1f121d9d-...`:

1. Connected a headless `socket.io-client` directly to `ws://127.0.0.1:5403`
   (bypassing ngrok — same server-side room/broadcast code a real phone client
   over the tunnel would hit; ngrok itself is just a reverse proxy in front of
   this same socket.io server).
2. `socket.emit('session:join', sessionId)`, then `socket.emit('session:input',
   { sessionId, data: 'echo TASK7_MARKER_1788177174\n' })`.
3. Received 3 `session:output` chunks (539 bytes total) over the socket,
   including the literal echoed marker:
   ```
   [socket-client] output chunk #2, 493 bytes, preview="...echo␈GTASK7_MARKER_1788177174\r..."
   ```
4. **Simultaneously**, the main process log showed **zero** `[native-term]`
   errors for the same window — meaning `NativeTerminalHost`'s `onOutput`
   subscription fed the identical coalesced bytes to `addon.feed()` for the
   attached overlay without throwing, for the same output chunks the socket
   client received.

This proves the central claim: one `SessionManager.onOutput` stream, coalesced
once, was consumed by two independent clients at the same time — a native
SwiftTerm overlay (real macOS window, confirmed via `CGWindowList`) and a
socket.io client (the same wire protocol a phone/mobile web client uses) —
with no ownership conflict, no blocking, no error on either path. **Not
proven:** the literal ngrok tunnel hop and the phone's own xterm.js rendering
— NEEDS-HUMAN for the physical device experience, though the server-side
behavior a tunnel would carry is identical to what was tested.

### 6. Quit and relaunch — session survives (argusd untouched).

**PASS.**

- Quit the flag-on dev instance via `osascript -e 'tell application "Electron" to quit'`
  (targets only the unpackaged dev process named "Electron" — verified distinct
  from the real "Argus" app throughout via `System Events` process listing).
- `argusd` (dev daemon, PID 34565) was never touched — still running after quit.
- Relaunched (flag off, for the next test) — log showed:
  ```
  Reattached session: task7-smoke-test (/Users/macbookpro10/development/projects/argus) [claude]
  ```
  alongside the pre-existing `projects`/`Rebrandly`/`api-product` sessions
  (left alone throughout — never written to). Confirms the test session
  survived the app-level quit/relaunch cycle via the daemon, exactly as designed.
- Real Argus app (PID 62995) and its argusd (PID 37560) were confirmed present
  and unaffected before and after every cycle in this task.

### 7. Unset the flag and relaunch — everything falls back to xterm.js with no visible change.

**PASS.**

- Rebuilt with both `ARGUS_NATIVE_TERM` and `VITE_ARGUS_NATIVE_TERM` unset
  (the default/production build state).
- Booted `npx electron --remote-debugging-port=9334 .` with no native env vars.
- `grep -i "native-term"` over the full boot log → **zero matches**.
- CDP: `window.electronNativeTerminal.available()` → `false`.
- App fully functional: server up, all 4 sessions (including the test one)
  reattached, socket clients connect normally.
- This is the same log/behavior shape as the pre-native-terminal baseline
  (`Server running`, `[PtyBackend]`, `Reattached session`, `Client connected`
  — no new lines, no new IPC activity, no behavior change observable from any
  test performed in this task).

### 8. Break the addon path deliberately — app still starts, logs the warning, uses xterm.js.

**PASS.**

- Renamed `native/addon/build/Release/argus_native_terminal.node` →
  `argus_native_terminal.node.bak` (simulating a missing/broken build artifact).
- Booted `ARGUS_NATIVE_TERM=1 npx electron --remote-debugging-port=9335 .`.
- Log showed the warning **exactly once**, then the app continued normally:
  ```
  [native-term] addon unavailable, using xterm.js: Error: Cannot find module
  '../../native/addon/build/Release/argus_native_terminal.node'
  ...
  Server running on 127.0.0.1:5403
  Reattached session: projects ...
  Reattached session: task7-smoke-test ...
  Client connected: ...
  ```
- CDP confirmed `window.electronNativeTerminal.available()` → `false` in this
  fallback state — the renderer correctly falls back to the xterm.js path.
- **Restored** the addon file immediately after (`mv ... .bak → argus_native_terminal.node`)
  and re-booted to confirm it loads cleanly again (`available()` → `true`, no warning) —
  addon file is back in its original state, nothing left broken.

## Additional automated coverage beyond the brief's checklist

- **Boot with flag ON, addon loads, no crash** — separately confirmed as its
  own item (folded into #1 above): `available()` → `true`, zero errors.
- **Overlay lifecycle cleanliness** — create → confirmed via `CGWindowList` →
  detach → confirmed the window disappears. No leaked native window across a
  full attach/detach cycle.
- **Cleanup:** the throwaway session (`task7-smoke-test`) was deleted via
  `DELETE /api/sessions/1f121d9d-...` at the end of testing; final
  `GET /api/sessions` shows only the pre-existing `projects`/`Rebrandly`/`api-product`
  sessions, untouched throughout. `git status` is clean. No stray Electron
  processes remained after the final quit; the real Argus app (62995) and its
  argusd (37560) were confirmed running, untouched, at every checkpoint.

## Summary

| # | Item | Result |
|---|---|---|
| 1 | SwiftTerm renders in Focus | PARTIAL (lifecycle: PASS; pixel rendering: NEEDS-HUMAN) |
| 2 | Input reaches agent, output streams back | PASS (visual display: NEEDS-HUMAN) |
| 3 | Resize reflows, no duplicated transcript | NEEDS-HUMAN |
| 4 | Wheel scroll works | NEEDS-HUMAN |
| 5 | Simultaneous native + phone/web client | **PASS** (phone substituted with headless socket client; core claim proven) |
| 6 | Quit/relaunch survives via argusd | PASS |
| 7 | Flag unset → silent, xterm.js fallback | PASS |
| 8 | Broken addon → warned, falls back, no crash | PASS |
| — | `lint` / `build:all` / `npm test` / `swift test` | PASS (all green) |

**5 PASS, 2 items with a NEEDS-HUMAN visual component (1 and 2 partially), 2 fully NEEDS-HUMAN (3 and 4), 0 FAIL.**

Working notes, raw logs, and the CDP/socket driver scripts used for this pass
are in `.superpowers/sdd/2026-08-28-native-terminal-phase-1/task-7-report.md`
(scripts themselves live under a scratch dir and are not part of the repo).
