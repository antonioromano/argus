# Surgical scrollback dedup on pty width change

**Date:** 2026-08-07
**Status:** approved, ready for implementation plan
**Supersedes:** the all-or-nothing `trimScrollbackOnResize` purge shipped in 0.21.8

## Problem

Claude Code hard-wraps its output to the pty width and re-prints its recent
transcript on SIGWINCH. The old copy keeps its old wrap — real newlines, which no
emulator can reflow — and has already scrolled above the screen, where Ink cannot
erase it. Result: one stale, wrongly-wrapped duplicate of the transcript per
distinct pty width the session has seen.

The existing mitigation purges the mirror's **entire** scrollback (`\x1b[3J` via
`TerminalMirror.clearScrollback`) on every width change. Because the mirror is
what replay serves, a purged session hands clients a screen-only frame and the
user reads that as "I can't scroll" — with thousands of rows still sitting in the
tmux pane. Width changes are constant in Argus (mosaic↔Focus, window resize, tile
drag, minimize/restore, viewer leave/rejoin), so the purge fires constantly. It
therefore ships off by default and the duplicates remain visible.

Cosmetic damage beat functional damage, so the flag stayed off — but that leaves
the original bug unfixed. This design removes the trade: delete only the rows
that are demonstrably a duplicate, keep everything else.

## Non-goals

- **Re-wrapping old history.** Impossible. The agent hard-wraps with real
  newlines, so the old width is baked into the stored rows. `capture-pane -J`
  only joins lines tmux itself wrapped. The only thing that renders that content
  at a new width is the agent reprinting it — which is what creates the duplicate.
- **The short-pane overflow leftover.** A second, separate mechanism: when a
  frame is taller than the pane, the overflow scrolls off before Ink's erase
  reaches it — one leftover per repaint, worst on minimized tiles (~14 rows).
  Out of scope here. Ship the width-change fix, measure, then decide.
  `IDLE_MIN_ROWS` already blunts this for unattached sessions.
- **Pinning columns and scaling the font.** Measured and rejected previously: a
  mosaic tile → Focus is a ~4× width jump, needing 13px → 3.3px type.

## Design

### Detection

New per-session field: `trimBoundary?: number`, set in `resizeSession` to the
mirror's `buffer.active.baseY` at the moment of a width change, captured **before**
`mirror.resize`. This marks where pre-resize history ends and the agent's repaint
begins.

The quiet check runs on the existing deferred path (`scheduleScrollbackTrim` →
`runScrollbackTrim`, `TRIM_QUIET_MS` = 600ms with re-arming, `TRIM_MAX_WAIT_MS` =
15s cap). The debounce and quiet-detection keep their current constants, but the
immediate-plus-deferred double trim collapses to a **single deferred pass**: there
is nothing to delete until the agent has actually reprinted. The immediate pass
existed only so a purge left Focus opening clean; a dedup has no such need.

On that pass:

1. Walk `mirror.term.buffer.active`. Split at `trimBoundary` (`B`): `old` = rows
   `[0, B)`, `new` = rows `[B, baseY + rows)`.
2. Normalize each side: `translateToString(true)` per row, drop empty rows, join
   with no separator. Joining with no separator de-wraps both sides, so the same
   logical text compares equal despite being hard-wrapped at two different widths.
3. Find the longest suffix of `old` that is a prefix of `new`. That is the
   reprinted region — the agent reprints the *tail* of its transcript.
4. Gate on `matched.length >= MIN_DEDUP_CHARS` (initial value 200). Below the
   threshold, return without touching anything.
5. Map the matched suffix back to rows: walk `old` backward, accumulating
   normalized length, until the match is covered. That row range is the stale
   block.

Height-only changes skip entirely — they do not rewrap. `trimBoundary` is cleared
after each run.

**Failure mode is deliberate.** No confident match means no action, so the worst
case is that duplicates remain — exactly today's default behavior. A misfire can
never lose history.

### Deletion

xterm exposes no row-range delete, and `\x1b[3J` is all-or-nothing, so the rows
are removed by rebuilding the buffer.

The rebuild happens **in place on the same `TerminalMirror` instance.** Swapping
in a fresh instance is wrong: `StateDetector` holds a private `mirror` reference
and registers a CSI handler on `mirror.term.parser`, so a swap would leave the
detector feeding a discarded terminal.

New method — `TerminalMirror.rebuildWithout(startRow, endRow): Promise<void>`:

1. Capture `screen = serializeScreen()` **before** mutating anything.
2. Re-emit the retained history rows as styled text: walk cells, emit an SGR run
   whenever fg/bg/attrs change, reset at row end. Covers 256-color and true-color
   plus bold/dim/italic/underline/inverse; anything unrecognized degrades to plain
   text rather than emitting a wrong sequence.
3. `markSeeding()` (suppresses `StateDetector`'s activity heuristic), then feed as
   one stream:
   `\x1b[2J\x1b[3J\x1b[H` → retained styled rows → `rows` newlines → `\x1b[H` → `screen`.
   The `rows` newlines are load-bearing: they push every retained row into
   scrollback so the restored screen paints over blanks instead of over history.
   Then `clearSeeding()`.

Everything routes through the mirror's existing write queue, so the rebuild cannot
interleave a live feed. The caller still calls `flushOutput()` first and stays
inside `chainTrim`, which serializes concurrent trims.

Afterwards, one `session:replay` with `reason: 'refresh'` — the same broadcast
`purgeScrollback` already performs, so a client whose user is scrolled up may
ignore it rather than have its viewport yanked to the bottom.

### Config

Dedup runs unconditionally on width changes. `trimScrollbackOnResize` is retired:
removed from the Settings overlay's Terminal section and from the `config.ts` PUT
allowlist. Persisted `true` values become inert; no migration, the key is ignored.

No kill switch, on purpose: the threshold gate bounds a misfire to "duplicates
remain", which is today's default. There is nothing to escape from, and a toggle
nobody flips is cruft.

The all-or-nothing purge survives on exactly one path — `clearBuffer` (Cmd+L) —
where wiping history is what the user asked for.

## Testing

Pure units, no emulator:

- normalization de-wraps: the same logical text hard-wrapped at 160 cols and at
  60 cols normalizes equal
- longest suffix/prefix matcher: exact overlap, no overlap, partial, below
  threshold, whole-history overlap
- row-range mapping: matched char count → correct start/end rows, including a row
  only partly covered by the match

`TerminalMirror.rebuildWithout`:

- rows outside the range survive; rows inside are gone
- the visible screen is byte-identical before and after
- a row written with SGR color keeps that color through the rebuild

`SessionManager`, extending the existing `SessionManager.trim.test.ts` fixture:

- real duplicate: feed history at 160 → `resizeSession(60)` → feed a reprint of
  the tail → `quietCheck()` → the stale copy is gone **and** `hist-line-0` is
  still present. This inverts today's `historyGone` assertion into a
  both-properties assertion.
- height-only change → no scan, no replay
- no match → no rebuild, zero `session:replay` emitted
- a burst of width changes → one rebuild, not one per step (the debounce in
  `scheduleScrollbackTrim` already provides this)

Deleted: the `trimScrollbackOnResize` allowlist tests in `config.test.ts`.

**Test hazard.** `mock.timers.enable({apis:['setTimeout']})` makes every
`mirror.feed()` / rebuild promise hang forever — xterm's `write(data, cb)`
callback rides a setTimeout-backed queue. Drive the deferred path by calling
`(sm as any).runScrollbackTrim(session)` directly, as the existing fixture's
`quietCheck()` does. Never `await` mirror work while the clock is mocked.

## Risks

- **The re-emitter is the sharp edge.** It reconstructs styling from cells rather
  than replaying original bytes, so unhandled cell attributes (hyperlinks, unusual
  color modes) degrade retained scrollback. Mitigated by falling back to plain
  text for anything unrecognized, and by asserting screen fidelity in tests.
- **Rebuild cost** is one buffer walk plus one re-feed of up to
  `MIRROR_SCROLLBACK` (5000) rows, per width change that actually duplicated.
  Bounded and off the hot path (runs only after the pty goes quiet), but worth
  measuring on a session with full history.
- **`MIN_DEDUP_CHARS` = 200 is a guess.** Too low risks matching coincidental
  repetition; too high leaves short duplicates behind. Tune against real sessions.
