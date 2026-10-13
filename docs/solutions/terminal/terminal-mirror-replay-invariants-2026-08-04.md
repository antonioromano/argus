---
title: TerminalMirror replay invariants — alt screen, scrollback ceiling, reseed, join ordering
date: 2026-08-04
category: docs/solutions/terminal/
module: server, daemon
problem_type: best_practice
component: TerminalMirror, SessionManager, socket handler, PtyManager
severity: high
applies_when:
  - Changing how session:join / session:replay are produced
  - Touching mirror scrollback size, resync/reseed, or output emission
  - Adding a pty backend (argusd, tmux, direct) that feeds the mirror
tags:
  - terminal-mirror
  - replay
  - scrollback
  - smcup
  - coalescing
  - argusd
---

Reconnect replay is a `serialize()` frame from the server's headless xterm (`TerminalMirror`). Four
invariants keep it correct; each was learned from a shipped regression.

## 1. The mirror must accumulate normal-buffer scrollback (strip smcup/rmcup)

With the outer terminal's `smcup`/`rmcup` intact, tmux parks its client on the **alternate** buffer and
redraws in place, so the mirror never gets scrollback and every replay landed clients on an
unscrollable alt screen (wheel dead in all shells).

Fix: `set-option -ga terminal-overrides ",*:smcup@:rmcup@"`, applied both in the tmux `-f` config
(fresh servers) and in `applyMouseConfig` (surviving servers never re-read the config).

argusd passes bytes untouched, with no multiplexer. A full-screen agent that emits its own smcup drives
the mirror onto the alt buffer the same way, so replay design for the daemon must keep this in mind.

## 2. Mirror depth is the ceiling on every client's scrollback — never shrink it

A join answers with a full frame that opens with `ESC[3J`, which wipes and replaces the client's
buffer. A client can therefore never scroll further back than the mirror holds.

An "adaptive scrollback" policy shrank the mirror to 1000 rows when the last viewer left a room.
Lowering xterm's `scrollback` **drops the oldest rows permanently**, and an ordinary tile unmount
(minimize, mosaic → focus) counted as a leave. The shrink was deleted; `MIRROR_SCROLLBACK = 5000`
for the mirror's life (~10 MB per idle mirror).

## 3. Reseed: keep the mirror and dedupe at a boundary, don't wipe it

Replaying argusd's 2 MB byte tail into an **empty** mirror yields about one screen: the agent repaints
in place, and those cursor moves originally landed on an already-scrolled screen. `beginResync` now
keeps the mirror, records a boundary, and after the burst settles deletes only what the replay
reprinted (`dedupeAtBoundary`, shared with the resize dedup).

The boundary is `totalRows() - 1` on purpose: a byte replay repaints the row under the cursor, so
counting that row as history splits the duplicate across the boundary and the match finds nothing.

Still open: after an app restart the mirror starts empty, so a restored session begins at one screen.
Fixing it needs the mirror persisted on shutdown and seeded on restore.

## 4. Coalesce output, and flush before join

Emitting one `session:output` per pty chunk (hundreds per second) left the renderer no idle gap, so
React commits starved: file-tree expands took 720 ms to several seconds under one streaming terminal.
`SessionManager` coalesces output per session into 16 ms buckets (`OUTPUT_COALESCE_MS`, with a 64 KB
early flush). Measured: 13–20 ms for the same expand under the same flood.

**Ordering invariant:** `session:join` calls `flushOutput(id)` *before* `socket.join()`. Pending bytes
are already in the mirror, so the replay frame covers them; flushing after the join paints them twice.
The exit path also flushes before `session:exit`. Companion terminals follow the same rule.

## Debug recipe

The packaged app on port 5757 has no auth on loopback when no password is set. `GET /api/sessions`,
then a read-only `socket.io-client` that emits `session:join` with an id. Count the lines in the
`session:replay` frame to see the true server-side depth. The frame also carries
`{alternate, appMouse, sgr}`.

Related: `docs/solutions/best-practices/argusd-restore-burst-blank-terminals-2026-09-01.md`.
