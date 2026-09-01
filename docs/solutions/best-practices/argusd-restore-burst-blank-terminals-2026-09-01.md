---
title: Blank terminals after an app update — the argusd restore burst
date: 2026-09-01
category: docs/solutions/best-practices/
module: daemon, server
problem_type: data_loss
component: argusd, DaemonClient, DaemonBackend
severity: high
applies_when:
  - Changing how argusd delivers a session's ring backlog (attach / replay)
  - Touching the daemon outbox limits (maxOutboxBytes / maxOutboxFrames)
  - Adding a code path that attaches many sessions at once
  - Debugging "all my terminals came back blank" after a restart or update
tags:
  - argusd
  - daemon
  - backpressure
  - replay
  - restore
  - terminal-mirror
---

## Symptom

After updating (or any app restart) **every** restored session's terminal is
blank. The agents are alive — the daemon still owns their ptys, the tiles show
their status — but nothing repaints, and an idle agent emits nothing that would.
Only sessions restarted afterwards show output.

Server-side fingerprint, from `POST /api/sessions/:id/diagnostics`:

```
feedCount = 0        # StateDetector never saw a byte
outputBufferBytes = 0
scrollback: (empty)  # the mirror is empty, so replay serves nothing
```

Zero bytes since app start on *every* restored session — the tell that this is
one connection-level event, not a per-session problem.

## Root cause

Restore attaches every session at once. Each `attach` made the daemon enqueue
that session's **whole 2MB ring** into the single bounded outbox
(`maxOutboxBytes = 8MB`) that also carries live output. Six or seven sessions
put 12–14MB in it in one lump, the outbox overflowed, and the daemon did what it
does for a consumer that has stopped draining: **closed the connection and
discarded the queued frames.** `DaemonClient` reconnected, `reattachAll()`
reproduced the identical burst, and the cycle repeated — so no session ever
received its backlog. Worse, each reconnect wiped every mirror first, so even a
partial success was destroyed.

Reproduced with a 6-session rig against the shipped 0.23.1 binary: connection
closed 76ms after the burst, **0 replay bytes delivered**. Four sessions (8MB,
exactly at the cap) survived; six did not.

## Fix (two independent layers, either one is sufficient)

1. **Daemon** — attach replay is not droppable live output. `replayAndSubscribe`
   walks the ring in 256KB chunks through `writeDataPaced`, which *waits* for
   outbox room instead of declaring the consumer dead, and never holds the
   session lock across a write. Live output stays suppressed until the backlog
   is drained (the read loop keeps filling the ring; the replay loop picks those
   bytes up), so the client still sees one ordered stream. A new `attached`
   control frame acks the session when its backlog is complete.
2. **Client** — `DaemonClient.attach()` is queued: one attach in flight at a
   time, released by the `attached` ack, by 500ms of silence, or by a 45s
   ceiling. The silence rule matters because an argusd predating the ack keeps
   running until its last session ends, so a freshly updated app must pace
   itself against an old daemon. `beforeSend` defers each mirror wipe to the
   moment its attach goes out, instead of blanking sessions still queued.

`ringBuffer.from(mark, max)` (absolute positions, clamped to the oldest byte
still held) is what makes paced replay possible: the producer may overwrite
bytes between chunks and the reader still knows where it is.

## Rules to keep

- **Backlog is not live output.** Anything the consumer *needs* (a replay, a
  handshake) must be paced; only live output may be dropped to protect memory.
- **One ring in flight.** Any new path that attaches N sessions must go through
  the queue rather than firing N attaches.
- The outbox cap is not a scaling knob: raising it just moves the session count
  at which the same collapse happens.
- A `Promise` that settles only on a positive event (`hello`) must also settle
  on the socket closing, or a refused connection hangs every caller of
  `backend.ready()`.
