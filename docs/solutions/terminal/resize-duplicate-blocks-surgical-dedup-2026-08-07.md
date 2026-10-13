---
title: Duplicated blocks after a terminal resize — surgical scrollback dedup
date: 2026-08-07
category: docs/solutions/terminal/
module: server
problem_type: rendering_bug
component: SessionManager, TerminalMirror, scrollbackDedup
severity: medium
applies_when:
  - Terminal history shows the same block twice at different wrap widths
  - Changing resize handling, trim timers or TerminalMirror.rebuildWithout
  - Writing node:test tests that await TerminalMirror work
tags:
  - resize
  - scrollback
  - dedup
  - terminal-mirror
  - node-test
---

## Cause (upstream, not Argus)

Claude Code hard-wraps output to the pty width and **reprints its recent transcript on SIGWINCH**. The
old copies keep their old wrap (real newlines, which no emulator can reflow) and have already
scrolled above the screen, where Ink cannot erase them. The result is one stale copy per distinct pty
width.

A second mechanism is still unfixed: when a frame is taller than the pane, the overflow scrolls off
before Ink's erase reaches it. Small tiles (~14 rows) show it most.

History can be recovered but never re-wrapped. Only the agent reprinting the content renders it at a
new width, and that reprint is exactly what creates the duplicate.

## Rejected design

`trimScrollbackOnResize` purged the whole mirror scrollback on a width change. A mosaic → focus switch
*is* a width change, so it wiped history during ordinary navigation. It was retired. Cmd+L
(`clearBuffer`) is the only remaining full purge.

## Current design

- On a width change, record `trimBoundary = mirror.totalRows()` **after** the mirror resize, because
  narrowing reflows rows and moves every absolute index.
- After output goes quiet (`TRIM_QUIET_MS` 600, `TRIM_MAX_WAIT_MS` 15 s), `findStaleRowRange`
  (`scrollbackDedup.ts`) normalizes the rows on each side of the boundary. It trims padding, drops
  blanks, and joins with no separator, which de-wraps both widths. It then finds the longest suffix of
  history that is a prefix of the new output, using KMP over `new \0 old` (a naive scan is O(n²) over
  ~1 MB).
- Three bails make it safe to run unconditionally: under `MIN_DEDUP_CHARS` (200), scrollback saturated
  (eviction shifted the boundary), or an overlap that straddles a row. A bail leaves the duplicate
  visible; history is never lost.
- `TerminalMirror.rebuildWithout(start, end)` re-emits the retained rows (styling rebuilt from
  `IBufferCell` into SGR runs), pushes them into scrollback, and repaints the pre-captured screen.
  It rebuilds **in place on the same mirror**, because `StateDetector` holds that terminal and has a
  CSI handler on its parser. Swapping instances orphans classification.

Pinning columns and scaling the font was ruled out: a mosaic tile → Focus is a ~4× width jump.

## Testing hazard

`mock.timers.enable({ apis: ['setTimeout'] })` in node:test makes every `TerminalMirror.feed()` /
`rebuildWithout()` promise hang forever: xterm's `write(data, cb)` callback runs on a setTimeout-backed
queue. Never await mirror work with a mocked clock. Drive deferred paths by calling the private method
directly. A `stateDetector` stub must forward `resize()` to `mirror.resize()`, or the buffer never
reflows and the row indices under test are wrong.
