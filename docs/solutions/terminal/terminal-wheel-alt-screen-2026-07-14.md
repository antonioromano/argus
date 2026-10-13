---
title: Wheel scrolling on Claude sessions (alt screen + mouse mode)
date: 2026-07-14
category: docs/solutions/terminal/
module: client, server
problem_type: input_bug
component: terminalMouse, useTerminal, PtyManager (tmux backend), SessionManager
severity: high
applies_when:
  - Changing wheel / mouse handling in the xterm terminal hooks
  - Wheel walks input history, or does nothing, on an agent TUI
  - Routing mouse reports through tmux
tags:
  - xterm
  - wheel
  - alternate-screen
  - tmux
  - mouse
---

## Facts that drive the design

- Claude Code is always on the alternate screen with SGR mouse tracking on. Its conversation history
  lives inside Claude, not in tmux history and not in xterm's normal buffer. The only way to scroll it
  is to deliver the wheel to Claude.
- xterm's own wheel listener sits on `terminal.element`, a child of Argus's container, so it fires
  first. On the alt buffer it turns wheel into arrow keys (which walk the agent's input history) and
  calls stopPropagation. Any `onWheel` on a parent is dead code there, which is why repeated fixes to
  Argus's `onWheel` never took effect.

## Client fix

Gate xterm with `terminal.attachCustomWheelEventHandler(() => !(buffer.active.type === 'alternate' &&
state.appMouse))`. xterm keeps its native behaviour everywhere else (arrow keys for a no-mouse pager,
scrollback on the normal screen). For the mouse-app-on-alt-screen case, Argus forwards a wheel report
itself. Don't fight xterm from a parent listener.

## tmux fallback: deliver to the pane, not the client

tmux 3.6b does **not** dispatch mouse reports written to the client's input, so the `WheelUpPane`
binding never fired. Wheel reports (`isWheelReport`: SGR buttons 64–67, legacy `ESC[M` + 0x60–0x63)
are detected in `SessionManager.writeToSession()` and sent straight to the pane with
`tmux send-keys -t <name> -l <seq>`, asynchronously and coalesced per 16 ms. They are kept out of
`hasUserInputSinceIdle`. The same path fixes mobile touch scroll.

Binding: `WheelUpPane if-shell -F '#{mouse_any_flag}' 'send-keys -M' 'copy-mode -e'`. A mouse app gets
the wheel; only a plain shell pane enters copy-mode. Forcing copy-mode on an alt-screen TUI shows an
empty `[0/0]`, because its history is not in tmux.

## Debugging a live session

Use the socket recipe in `terminal-mirror-replay-invariants-2026-08-04.md`. `session:replay` carries
`{alternate, appMouse, sgr}`, and `session:input` replicates what the client forwards. On the tmux
backend, check the real pane flags with
`tmux -L argus list-panes -a -F '#{alternate_on} #{mouse_any_flag}'`.
