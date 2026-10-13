---
title: Debugging the real Electron renderer and a live server (CDP, socket.io, process tools)
date: 2026-08-20
category: docs/solutions/debugging/
module: client, server, electron
problem_type: best_practice
component: Electron renderer, socket handler, Electron main
severity: medium
applies_when:
  - A UI bug involves real focus/blur, pointer, paint or font behaviour
  - A Vitest/jsdom repro passes but the app is still broken
  - The packaged app freezes, won't start, or shows the wrong UI
tags:
  - debugging
  - cdp
  - electron
  - jsdom
  - socket-io
---

## jsdom can't see focus, pointer or paint bugs

A passing Vitest repro proves nothing about real focus, pointer or paint semantics. Reproduce in the
real renderer:

```bash
ARGUS_PORT=5403 npx electron . --remote-debugging-port=9222   # dev profile, isolated data + daemon socket
curl -s http://127.0.0.1:9222/json/list                       # page webSocketDebuggerUrl
```

Drive it from a Node script with the global `WebSocket` (Node 22+) or `ws`:

- `Runtime.evaluate` to install MutationObserver / focusin / focusout logging and to read element rects.
- `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` for **real** clicks and typing. A synthetic
  `dispatchEvent` skips browser focus behaviour, which is exactly what hides focus bugs.
- `Page.captureScreenshot` to see the result.

Electron serves the local `client/dist`, so run `npm run build:all` before verifying a source change.
Kill the instance with `pkill -f "remote-debugging-port=9222"`. The chrome-devtools MCP runs its own
Chrome and cannot attach to Electron.

Caveat: a debug-port relaunch changes GPU and cache timing. For cold-start render bugs, a clean CDP
screenshot is not proof (see `terminal/terminal-garble-tmux-utf8-locale-2026-06-01.md`). Use
`screencapture` of the real screen.

## Talking to a live server without the UI

On loopback with no password set, the server needs no token. `GET /api/sessions`, then a read-only
`socket.io-client` that emits `session:join` with an id. `session:replay` returns the server's
authoritative screen and modes. `POST /api/sessions/:id/diagnostics` gives per-session counters
(`feedCount`, `rawTailBytes`, ...).

## Process-level tools for the packaged app

- **Won't start or crashes early:** run `/Applications/Argus.app/Contents/MacOS/Argus` from a terminal.
  The server logs with `console.log`, so stdout shows the error.
- **Beachball:** `sample <pid>` shows where the main thread is blocked.
- **Spinning helper processes:** `lsof -p <pid>`. Pipes where a tty was expected is the tell for an
  orphaned client.
- **Memory:** the packaged app has the inspect fuse off, so use `footprint <pid>` and
  `vmmap --summary <pid>`. Heap snapshots need a dev build. **Measure before optimizing.** The
  2026-10 profile found the JS heap at ~117 MB, while ~530 MB of main's footprint was `CG image` +
  `CoreAnimation` (see `docs/reviews/2026-10-11-argus-review.md` §1).
- **Duplicate agents:** check `ps` for `claude` children of argusd daemons from other profiles or
  labels. `findDuplicateDaemons` logs a warning at startup, and argusd now holds a per-data-dir lock.
