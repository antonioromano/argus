# Bundled tmux binaries

Argus runs each agent (claude/gemini/codex) inside a **tmux** session so the
process is owned by the tmux server daemon — not by the Electron app. This lets
sessions **survive an app quit / self-update / crash** and reattach on next
launch. (A full Mac reboot still kills the tmux server, which is acceptable.)

To make this work in the packaged app with zero user install, drop static,
dependency-free macOS tmux binaries here, named by CPU arch:

```
electron/resources/tmux/
  tmux-arm64    # Apple Silicon
  tmux-x64      # Intel
```

electron-builder copies this directory into the app bundle at
`<App>.app/Contents/Resources/tmux/`, and `PtyManager.resolveTmux()` looks for
`process.resourcesPath/tmux/tmux-<process.arch>` at runtime.

## Resolution order (PtyManager.resolveTmux)

1. `ARGUS_TMUX_PATH` env var (dev escape hatch)
2. bundled `tmux/tmux-<arch>` in the app's Resources
3. system `tmux` on PATH (`which tmux`)
4. none → non-persistent fallback (sessions die on quit, as before)

## Getting a static binary

Build a static tmux (statically links libevent + ncurses) or grab a prebuilt
static macOS binary, then `chmod +x` it and place it here with the arch suffix.
Verify it runs standalone:

```bash
./tmux-arm64 -V        # prints e.g. "tmux 3.5a"
```

## Dev

In dev (`npm run dev`) there is no packaged Resources dir, so install tmux via
`brew install tmux` (resolved through PATH) or set `ARGUS_TMUX_PATH` to a binary.
Without either, dev runs in non-persistent mode and sessions die on quit.

## Notes

- These binaries are intentionally **not** committed (see repo `.gitignore`
  handling); each build machine / release step supplies them.
- When code signing is later enabled (`build.mac.identity` is currently `null`),
  the bundled binary must be signed/notarized too or Gatekeeper will block it.
