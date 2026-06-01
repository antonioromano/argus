# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Argus is an **Electron desktop app** for managing multiple Claude Code CLI sessions on macOS. It spawns `claude` processes via pseudo-terminals (node-pty), streams their I/O through Socket.io to a React frontend with xterm.js terminals, and detects session state (running/waiting/idle/exited) by analyzing terminal output. A mobile companion (`/mobile` route) is reachable from a phone browser via ngrok tunnel.

## Commands

```bash
# Install dependencies (monorepo-wide)
npm install

# Run the Electron app in dev mode (builds all workspaces, then launches Electron)
npm run dev

# Package a signed macOS .dmg
npm run package:mac

# Build all workspaces (shared → server → client → electron)
npm run build:all

# Lint (client only)
npm run lint -w client
```

The `dev:web` escape-hatch (`PORT=5401 ... concurrently … server … client`) still exists for fast hot-reload iteration on UI changes, but Electron is the only supported client surface. The browser `<header>` and `window.confirm` fallback have been removed.

## Architecture

**Monorepo** with npm workspaces: `shared/`, `server/`, `client/`.

### shared/
Single file (`src/types.ts`) defining all shared TypeScript types: session models, REST request/response shapes, Socket.io event maps (`ClientToServerEvents`, `ServerToClientEvents`), and filesystem types.

### server/ (Express + Socket.io + node-pty)
- **`services/SessionManager`** — Central orchestrator. Creates/destroys sessions, manages pty lifecycle, buffers output (100KB rolling window for reconnect replay), persists sessions to disk, and broadcasts state changes via Socket.io rooms.
- **`services/PtyManager`** — Spawns `claude` CLI via the user's login shell (`$SHELL -l -c "exec claude"`). Wraps node-pty for write/resize/kill.
- **`services/StateDetector`** — Analyzes ANSI-stripped terminal output to detect session status. After output settles (500ms), checks tail against prompt patterns to distinguish `waiting` (prompt detected) from `idle` (output stopped, no prompt).
- **`persistence/SessionStore`** + **`persistence/OrderStore`** — JSON file stores in `server/data/`. Sessions are restored on server restart.
- **`socket/handler`** — Socket.io connection handler. Clients join/leave session rooms; input is forwarded to pty; buffered output is replayed on join.
- **`routes/sessions`** — REST CRUD for sessions + ordering.
- **`routes/filesystem`** — Path autocomplete and directory browsing for the session creation UI.

### client/ (React + Vite + xterm.js)
- **`App`** — Top-level layout with theme toggle (dark/light, persisted to localStorage) and focus mode (Escape to exit).
- **`components/Dashboard`** — Grid of session cards with drag-and-drop reordering (@dnd-kit).
- **`components/TerminalPanel`** — xterm.js terminal with the built-in **DOM renderer** (no WebGL/Canvas addon), wired to Socket.io for I/O. GPU-atlas renderers were dropped in 0.16.13: WebGL (0.16.0) hit the ~16-context cap in the mosaic, and both WebGL and Canvas baked glyph/cell metrics at init that garbled on a cold Electron start until reload. The DOM renderer reflows on font load and is immune — the clean v0.15.1 behavior.
- **`hooks/useSocket`** — Singleton Socket.io client (WebSocket transport preferred).
- **`hooks/useSessions`** — Session list state synced via REST + Socket.io events.
- **`hooks/useSessionOrder`** — Persisted drag-and-drop ordering.

### Communication Flow
Client ←(REST)→ Server for CRUD. Client ←(Socket.io rooms)→ Server for real-time terminal I/O and status updates. Each session is a Socket.io room identified by session UUID. Vite proxies `/api` and `/socket.io` to the server in dev.

### Documented Solutions
`docs/solutions/` — documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas.

## Versioning

When bumping the version, update it in **both** `package.json` (root) and the version badge in `README.md` (the shield.io badge URL on line 3 contains the version string: `![Version](https://img.shields.io/badge/version-X.Y.Z-blue)`).

### How to release a new version

```bash
# 1. Update version in both files:
#    - package.json  →  "version": "X.Y.Z"
#    - README.md     →  version-X.Y.Z-blue (in the badge URL)

# 2. Commit and tag
git add package.json README.md
git commit -m "bump version to X.Y.Z"
git tag vX.Y.Z

# 3. Push commit and tag
git push origin master
git push origin vX.Y.Z
```

Users update via `argus update`, which fetches the latest tag and checks it out. The version displayed in the UI comes from `package.json`, so it **must** match the tag.

## Key Details

- Server port: **5400**, Client dev port: **5402** (Vite dev server proxies API/WS to server on 5401)
- TypeScript strict mode, ES2022 target, ESM (`"type": "module"`) throughout
- Server uses `.js` extensions in imports (required for ESM resolution with TypeScript)
- Session data files (`server/data/sessions.json`, `server/data/order.json`) are gitignored
- `node-pty` requires a native prebuilt binary; `postinstall` script ensures the macOS ARM64 spawn-helper is executable
