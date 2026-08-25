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

# Test (server uses node:test, client uses Vitest)
npm test            # runs server + client
npm test -w server
npm test -w client
```

CI (`.github/workflows/ci.yml`) runs `lint → build:all (typecheck) → test` on every PR and push to `main` (macos-15, Node from `.nvmrc`). Keep it green — it gates merges.

The `dev:web` escape-hatch (`PORT=5401 ... concurrently … server … client`) still exists for fast hot-reload iteration on UI changes, but Electron is the only supported client surface. The browser `<header>` and `window.confirm` fallback have been removed.

## Architecture

**Monorepo** with npm workspaces: `shared/`, `server/`, `client/`.

### shared/
Single file (`src/types.ts`) defining all shared TypeScript types: session models, REST request/response shapes, Socket.io event maps (`ClientToServerEvents`, `ServerToClientEvents`), and filesystem types.

### server/ (Express + Socket.io + node-pty)
- **`services/SessionManager`** — Central orchestrator. Creates/destroys sessions, manages pty lifecycle, buffers output (100KB rolling window for reconnect replay), persists sessions to disk, polls git-dirty status, prevents sleep while running, and broadcasts state changes via Socket.io rooms.
- **`services/PtyManager`** — Spawns the agent CLI inside a tmux session (`tmux -L argus`) via the user's login shell. Sets a UTF-8 spawn locale (load-bearing — see memory `argus-terminal-replay`). Wraps node-pty for write/resize/kill + tmux capture-pane snapshots.
- **`services/StateDetector`** — Analyzes ANSI-stripped terminal output (headless xterm) to detect session status. After output settles (500ms), checks the tail against per-agent prompt patterns to distinguish `waiting` from `idle`. Also extracts the last prompt text for notifications.
- **`services/AgentRegistry`** — Built-in + custom agent definitions (claude/gemini/codex); validates `agentType` before spawn (command-injection guard). **`services/GitService`** — diff/stage/commit/branch/worktree/blame (~22 git routes). **`services/AuthService`** + **`LoginRateLimiter`** — scrypt password hash, 24h bearer tokens, rate-limited login (auth enforced when exposed or a password is set). **`services/NgrokService`** / **`UpdateService`** / **`CompanionTerminalManager`** / **`EphemeralTerminalManager`** / **`SleepPreventionService`** / **`services/WindowRegistry`** — tracks window lifecycle and session→window ownership.
- **`persistence/`** — atomic-write JSON stores in `server/data/`: `SessionStore`, `OrderStore`, `GroupStore`, `ConfigStore`, `WindowStore` (windows.json), plus per-gitRoot `ChangelistStore` / `CommitSelectionStore`. Sessions and windows are restored on server restart.
- **`socket/handler`** — Socket.io connection handler (token-gated when enforced). Clients join/leave session rooms; input is forwarded to pty; a tmux capture-pane snapshot is replayed on join. Also drives companion + ephemeral terminals.
- **`routes/`** — `sessions` (CRUD + ordering), `filesystem` (scoped file read/write/search + folder-picker autocomplete/children), `git`, `symbols` (ripgrep go-to-def / find-refs), `worktrees`, `config`, `auth`, `ngrok`, `update`.
- **`middleware/auth`** + **`utils/pathScope`** — bearer-token gate (fail-closed when exposed) and session-scoped path containment. **Every** new fs/git route must funnel through `pathScope`; remote-reachable requests must use `authFetch`.

### client/ (React + Vite + xterm.js + Monaco)
- **`app/ArgusApp`** — Top-level shell (theme toggle, focus mode, command palette, overlays); routes `/mobile` → `app/mobile/MobileApp` (read-only terminals).
- **`app/views/Mosaic`** — Grid of up to 12 terminal tiles with drag-and-drop reordering (@dnd-kit) + minimized chips. `app/views/Focus` — single shell + docked workbench panels. Leaf tiles + `TerminalShell` are `React.memo`-wrapped (handlers stabilized via a latest-ref pattern).
- **`app/ui/TerminalShell`** + **`hooks/useTerminal`** — xterm.js with the built-in **DOM renderer** (no WebGL/Canvas). GPU-atlas renderers were dropped in 0.16.13 (WebGL hit the ~16-context cap; both baked glyph/cell metrics wrong on cold Electron start). The DOM renderer reflows on font load and is immune. `doFit()` is the single relayout funnel; wheel handling goes through `attachCustomWheelEventHandler` — both load-bearing.
- **`components/explorer/`** (Monaco workbench) — `MonacoPane`, editor tabs, `registerSymbolProviders` (server-backed go-to-def/find-refs); `panels/{ExplorerWorkbench,DiffWorkbench}`.
- **`hooks/`** — `useSocket` (singleton WS client), `useSessions`, `useOrder`/`useGroups` (persisted ordering + groups), `useGitDiff`/`useGitFileStatuses`, `useFileBuffer`/`useFileTree`/`useEditorGroups`, `useNotifications`, `useConfig`, `useUpdate`, `useNgrok`. **`services/api`** — REST client; use `authFetch` (never bare `fetch`) so the ngrok-auth header is sent.
- A strict CSP ships in `index.html` (`script-src 'self'`); the renderer is sandboxed. Keep both intact when adding inline scripts or new connect origins.

### Communication Flow
Client ←(REST)→ Server for CRUD. Client ←(Socket.io rooms)→ Server for real-time terminal I/O and status updates. Each session is a Socket.io room identified by session UUID. Vite proxies `/api` and `/socket.io` to the server in dev.

### Documented Solutions
`docs/solutions/` — documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas.

## Versioning

When bumping the version, update it in **both** `package.json` (root) and the version badge in `README.md` (the shield.io badge URL on line 3 contains the version string: `![Version](https://img.shields.io/badge/version-X.Y.Z-blue)`).

### How to release a new version

```bash
# 1. Bump the version in root package.json, then sync everything else:
#    - edit package.json  →  "version": "X.Y.Z"  (root is the single source of truth)
#    - run `npm run sync-versions`  →  stamps shared/server/client package.json + the README badge

# 2. Commit and tag
git add package.json README.md
git commit -m "bump version to X.Y.Z"
git tag vX.Y.Z

# 3. Push commit and tag
git push origin main
git push origin vX.Y.Z
```

CI (`release.yml`) triggers on the tag push, builds the DMG, creates the GitHub release with **auto-generated release notes** (commits since the previous tag), and bumps the Homebrew cask. The "WHAT'S NEW" section in the Argus update dialog pulls those notes from the GitHub release body.

**Write meaningful commit messages before tagging** — they become the changelog. Conventional commit prefixes (`feat:`, `fix:`, `chore:`) appear verbatim in the release notes. The CI-generated `chore: bump cask` commit is excluded automatically via `.github/release.yml`.

To override auto-generation with a hand-written changelog, edit the GitHub release body after CI completes (or pass `body:` in the release workflow step — it takes precedence over `generate_release_notes`).

Users update via the in-app update button (Homebrew) or `brew upgrade --cask argus`. The version displayed in the UI comes from `package.json`, so it **must** match the tag.

## Key Details

- Multi-window — each Electron window loads `?windowId=<id>` in the query string; session→window ownership lives server-side in `windows.json`; sessions render expanded only in their owning window.
- Ports by mode — packaged app: **5757**; `npm run dev` (Electron): **5403**; `dev:web`: server **5401** + Vite client **5402** (proxies API/WS to 5401). Each mode also gets its own Electron `userData` profile (`argus` vs `argus-dev`), tmux socket (`argus` vs `argus-dev`), and `argus://` vs `argus-dev://` deep-link scheme — so the installed app and `npm run dev` can run **at the same time**.
- TypeScript strict mode, ES2022 target, ESM (`"type": "module"`) throughout
- Server uses `.js` extensions in imports (required for ESM resolution with TypeScript)
- Session data files (`server/data/sessions.json`, `server/data/order.json`) are gitignored
- `node-pty` requires a native prebuilt binary; `postinstall` script ensures the macOS ARM64 spawn-helper is executable
