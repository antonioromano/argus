---
title: Garbled terminal glyphs (icon/❯ → "_") — tmux downgrades UTF-8 for a non-UTF-8 client
date: 2026-06-01
category: docs/solutions/terminal/
module: server, client, electron
problem_type: rendering_bug
component: PtyManager, tmux backend, xterm renderer
severity: high
applies_when:
  - Terminal shows "_" or black boxes where block elements / dingbats should be, while box-drawing "─" renders fine
  - Adding a new spawn path for a pty or a terminal multiplexer client
  - Considering a GPU (WebGL/Canvas) xterm renderer addon
  - Verifying a fix for an intermittent or cold-start-only render bug
tags:
  - tmux
  - locale
  - utf-8
  - xterm
  - renderer
  - debugging-method
---

## Symptom

In the packaged app (launched from Finder/Dock), Claude's welcome icon `▐▛███▜▌` became black
boxes and `❯` became `_`. `─` separators and ASCII text were fine. `npm run dev` and launches from a
terminal never showed it. Cmd+R did not fix it; new sessions were broken too.

## Root cause

**tmux downgrades UTF-8 cells it cannot represent for a non-UTF-8 *client* to `_`.** The decision is
per client, from the client's `LC_ALL`/`LC_CTYPE`/`LANG` at attach. Box-drawing survives because tmux
draws lines through ACS, which has no block/dingbat equivalent.

Argus's tmux client is spawned by node-pty with the Electron process env. A GUI-launched macOS app
often has **no `LANG`** (launchd does not reliably set one), so the client attached as non-UTF-8.
Shell-launched and dev runs inherit the shell's `LANG`, which is why they were clean.

## Fix

`PtyManager.spawnEnv()` sets `LANG=LC_ALL=en_US.UTF-8` when no UTF-8 locale is present, for every
`pty.spawn` (tmux client and direct spawn). Proof: a node-pty tmux client with `LANG` stripped
received `___ _ done` for `▐▛█ ❯ done`; with `LANG=en_US.UTF-8` it received the real characters.

The argusd backend has no multiplexer in the byte path, so this specific downgrade does not apply
there, but any new path that puts a terminal client between the agent and the mirror needs the
same guarantee.

## What it was not (ruled out over ~12 releases — don't re-chase)

- **Replay slicing** was a real but separate bug: replaying a raw byte tail cut mid-escape garbled
  Cmd+R. Replay is now a serialized `TerminalMirror` frame, so it always starts on a clean state.
- **Renderer:** WebGL (one GL context per terminal, ~16-context cap) and Canvas both bake glyph atlas
  and cell metrics at init and can bake them wrong on a cold Electron start. Argus now uses xterm's
  **built-in DOM renderer** — keep it. Renderer ranking for a many-terminal Electron grid:
  DOM > Canvas > WebGL.
- `app.disableHardwareAcceleration()` (still set in `electron/src/main.ts`) removes the GPU raster path;
  it did not fix this bug.
- Fonts, fractional DPR, vibrancy and transparency all rendered clean in faithful harnesses.

## Lessons

- **Test the bytes the consumer actually receives, over its real transport and locale.**
  `tmux capture-pane` renders the grid in UTF-8 regardless of client locale, and CDP screenshots
  re-render the page, so both always looked clean and masked the bug.
- For an intermittent or cold-state-only bug, a clean local launch proves nothing: warm caches mask
  it. Verify at the mechanism level, or get the user's own screenshot of the failing state first.
- To test a local build, run the binary directly
  (`dist/mac-arm64/Argus.app/Contents/MacOS/Argus`): `open dist/.../Argus.app` launches the installed
  `/Applications/Argus.app`, because both share a bundle id.
