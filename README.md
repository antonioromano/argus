# Argus

![Version](https://img.shields.io/badge/version-0.16.57-blue) ![Node](https://img.shields.io/badge/node-18%2B-green) ![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)

A web-based dashboard for managing multiple AI coding agent sessions simultaneously. Spawn [Claude Code](https://claude.ai/code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), or [OpenAI Codex](https://github.com/openai/codex) processes via pseudo-terminals, stream their I/O to browser-based terminals, and monitor session state in real time.

![Argus Dashboard](images/dashboard.png)

## Table of Contents

- [Installation](#installation)
- [Desktop App](#desktop-app)
- [Prerequisites](#prerequisites)
- [Features](#features)
  - [Session Management](#session-management)
  - [Layout & Organization](#layout--organization)
  - [Focus Mode](#focus-mode)
  - [Terminal](#terminal)
  - [File Explorer](#file-explorer)
  - [Git Diff Viewer](#git-diff-viewer)
  - [Git Commit & Staging](#git-commit--staging)
  - [Multi-Agent Support](#multi-agent-support)
  - [Remote Access](#remote-access)
  - [Password Authentication](#password-authentication)
  - [Auto-Update](#auto-update)
  - [Notifications](#notifications)
  - [Mobile Support](#mobile-support)
  - [Theme](#theme)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
- [How It Works](#how-it-works)
- [Development](#development)
- [Tech Stack](#tech-stack)

## Installation

### Desktop App (macOS)

Install via Homebrew:

```bash
brew tap antonioromano/argus https://github.com/antonioromano/argus
brew install --cask argus
```

> The app is unsigned. On first launch, right-click → **Open** to bypass Gatekeeper.

### Manual (macOS / Linux)

```bash
git clone https://github.com/antonioromano/argus.git
cd argus
./setup.sh
```

`setup.sh` handles everything in 5 steps:

1. **Node.js check** — Requires v18+; exits with install instructions if missing
2. **System dependencies** — Verifies `git` and `curl`; on Linux, checks for `python3`, `make`, `g++` (required for node-pty native compilation)
3. **Install dependencies** — Runs `npm install` across all workspaces
4. **AI CLI detection** — Finds installed agents and warns if none are detected
5. **`swarm` command** — Creates a symlink in `~/.local/bin` or `/usr/local/bin`

### Starting the dashboard

```bash
swarm start
```

The service starts in the background (via `screen`, `tmux`, or `nohup` — whichever is available) and opens the dashboard in your browser when ready. Your terminal is returned immediately.

```bash
swarm              # Show service status
swarm start        # Start in background, open browser
swarm stop         # Stop the service
swarm logs         # Tail live output
swarm attach       # Attach to the live session (screen/tmux only)
swarm help         # Show all commands
```

### Production deployment

For a persistent, always-on installation (e.g., served over Tailscale), use the `argus` CLI instead of `swarm`:

```bash
git clone https://github.com/antonioromano/argus.git ~/argus
cd ~/argus
npm install && npm run build
bin/argus setup     # Symlink 'argus' into PATH
argus run           # Start in foreground, or:
argus start         # Daemonize in background
```

Configure via environment variables:

```bash
ARGUS_PORT=5500 argus start                     # Custom port
ARGUS_PORT=5500 ARGUS_DATA_DIR=/var/argus/data argus start  # Custom port + data dir
```

Update to the latest release:

```bash
argus update                # Latest tag
argus update v0.12.0        # Specific tag (or downgrade)
```

All session data lives in `ARGUS_DATA_DIR` (default: `server/data/`). The repo is stateless after build — back up your data dir; the repo can always be re-cloned and rebuilt.

Run `argus help` for the full command reference. See [docs/deployment.md](docs/deployment.md) for launchd (macOS) and reverse proxy setup.

### Uninstalling

```bash
./uninstall.sh
```

Stops the running service, removes the `swarm` symlink, and cleans up runtime files. Optionally removes `node_modules/`. Project files are left intact.

## Desktop App

Argus can be packaged as a native macOS desktop application using Electron.

### Building

Build all workspaces (shared, server, client) and the Electron main process in one step:

```bash
npm run build:all
```

### Running Electron in dev mode

```bash
npm run electron:dev
```

This runs `build:all` first, then launches Electron directly from the repo.

### Packaging a DMG

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac
```

Code signing is disabled (`identity: null`) so no Apple Developer account is required. The packaged `.dmg` for `arm64` and `x64` will be output to the `dist/` directory.

### First launch (Gatekeeper)

Because the app is unsigned, macOS Gatekeeper will block it on first launch. Right-click (or Control-click) the app and choose **Open** to bypass the warning.

### Data location

When running as a packaged desktop app, all session data is stored in:

```
~/Library/Application Support/Argus/
```

## Prerequisites

- **Node.js** v18+
- **At least one AI CLI** installed and available in `$PATH`:
  - Claude Code: `npm install -g @anthropic-ai/claude-code`
  - Gemini CLI: `npm install -g @google/gemini-cli`
  - OpenAI Codex: `npm install -g @openai/codex`
- **macOS** or **Linux** (WSL is untested)
- **Linux only:** `build-essential` and `python3` (for node-pty native compilation)

## Features

### Session Management

- **Create sessions** — Pick a project folder (system picker or interactive folder tree), set an optional name, and choose which AI agent to run
- **Clone sessions** — Duplicate an existing session in the same folder with a different agent or different CLI flags
- **Delete sessions** — Close sessions with a confirmation prompt
- **Status badges** — Each session shows its real-time state: `waiting` (prompt visible), `running` (agent processing), `idle` (quiet, no prompt), or `exited`
- **Collapsible sessions** — Minimize any session to a chip strip at the top of the dashboard; collapsed sessions stay connected via Socket.io and continue showing live status, then restore with one click
- **Agent CLI flags** — Configure per-agent command-line flags (e.g. `--model`, `--verbose`) in Settings with sticky defaults; toggle individual flags on or off per session at creation time
- **Git dirty indicator** — Orange warning icon next to session names when uncommitted changes exist; visible in terminal cards, focus mode, sidebar, collapsed chips, and dropdowns

### Layout & Organization

- **Grouped grid** — Sessions are automatically grouped by their working folder
- **Drag-and-drop reordering** — Rearrange both groups and individual sessions within groups via drag handles
- **Persistent order** — Session ordering is saved to disk and restored on page reload

### Focus Mode

- **Full-screen session** — Click into any session to expand it, with the terminal taking up most of the view
- **Collapsed session strip** — Other sessions appear as a horizontal mini bar with status indicators for quick switching
- **Explorer panel** — Toggle a file explorer alongside the terminal in focus mode; mutually exclusive with the diff panel
- **Exit** — Press **Escape** or click the back button to return to the grid

### Terminal

- **xterm.js terminal** — Smooth, high-performance terminal in the browser
- **Live two-way I/O** — All keyboard input and terminal output streams via Socket.io in real time
- **Reconnect replay** — A 100KB rolling buffer per session replays output when you reconnect or reload
- **Full terminal features** — Clickable links, copy-paste, and responsive resizing

### File Explorer

- **Browse project files** — Tree-based file browser scoped to each session's working directory, with a session sidebar for switching between projects
- **Syntax highlighting** — 29 languages supported via Prism (TypeScript, JavaScript, Python, Rust, Go, Java, C/C++, C#, Ruby, PHP, Swift, Kotlin, SQL, GraphQL, YAML, TOML, Dockerfile, Makefile, and more)
- **File search** — Search by filename or file content with debounced real-time results
- **Inline editing** — Edit files directly in the browser; conflict detection compares `mtime` to prevent overwriting changes made by the agent after you opened the file
- **Markdown preview** — Markdown files render with full formatting
- **Copy to clipboard** — One-click copy of the full file contents
- **Resizable panels** — Drag dividers between sidebar, file tree, and preview columns; sizes persist to localStorage
- **Ephemeral terminal** — Open a real shell in the session's working directory from the Explorer view without creating a new session
- **State persistence** — Selected session, file, and search query persist across tab switches

### Git Diff Viewer

- **Inline diff panel** — Opens alongside the terminal in focus mode, showing the current git state of the session's folder
- **Three diff sections** — Unstaged changes, staged changes, and branch changes displayed separately
- **Auto-refresh** — Polls for new changes every 3 seconds while the session is running; manual refresh button also available
- **File-level breakdown** — Expandable file sections with per-file addition/deletion counts; `NEW` and `DELETED` badges for created or removed files
- **Diff fullscreen** — Expand the diff panel to full screen; press **Escape** to collapse

### Git Commit & Staging

- **Commit mode** — Toggle commit mode in the diff panel to enter a staging workflow alongside the live diff
- **Selective staging** — Stage changes at the file, hunk, or individual line level using tri-state checkboxes (none / partial / all selected)
- **Commit bar** — Write a commit message, toggle amend mode (pre-fills the last commit message), and commit with one click or **Ctrl/Cmd+Enter**
- **Discard with undo** — Discard selected changes with a 30-second in-memory undo window; applies at the hunk or line level
- **Stale diff detection** — If the diff refreshes while commit mode is active, a warning banner notifies you before you stage outdated selections

### Multi-Agent Support

- **Built-in agents** — Claude Code, Gemini CLI, and OpenAI Codex available out of the box
- **Custom agents** — Add any CLI tool as an agent via Settings (name + command)
- **Default agent** — Configure which agent is pre-selected when creating new sessions
- **Install detection** — Settings panel shows which agents are installed and their resolved paths, with install commands for missing ones

### Remote Access

- **ngrok tunnel** — Expose the dashboard publicly via an ngrok tunnel directly from the toolbar
- **One-click start/stop** — Start and stop the tunnel from the header; copy or open the public URL
- **Sleep prevention** — Keeps the computer awake while the tunnel is active (`caffeinate` on macOS, `systemd-inhibit` on Linux)
- **Install guidance** — If ngrok is not installed, shows OS-specific install instructions (Homebrew on macOS, snap on Linux)

> **Security note:** The public URL grants full terminal access to all sessions. Share it only with trusted users.

### Password Authentication

- **Auto-enabled with ngrok** — When a tunnel is started, you set a password; the URL and password are shown together for easy sharing
- **Secure comparison** — Passwords are hashed with SHA-256 and compared using `crypto.timingSafeEqual` to prevent timing attacks
- **Token-based sessions** — After login, a UUID token is issued and validated on all subsequent API and Socket.io requests; tokens are cleared when the tunnel stops

### Auto-Update

- **Hourly version check** — Compares `package.json` version against the remote GitHub repository (with a 60-second cooldown between manual rechecks)
- **One-click update** — When a new version is available, a modal shows the version diff and changelog; clicking "Update Now" runs `git pull` + `npm install` and restarts the server
- **Safety guard** — Refuses to update if the working tree has uncommitted local changes

### Notifications

- **Desktop notifications** — Fire when a session transitions to `waiting` while the app is not in focus; click to focus the app. The packaged (ad-hoc signed) build delivers via a bundled [terminal-notifier](https://github.com/julienXX/terminal-notifier): macOS asks once to allow notifications from "terminal-notifier" — accept it, and make sure that entry stays enabled in System Settings → Notifications
- **Tab title badge** — Document title shows `(N) Argus` with the count of sessions awaiting input
- **Waiting count badge** — Orange badge on the Sessions navigation tab shows how many sessions need attention
- **Configurable** — Toggle on/off in Settings; browser permission requested on first enable; gracefully hidden on unsupported browsers
- **Auto-dismiss** — Notifications close automatically when the session leaves `waiting` status or is deleted

### Mobile Support

- **Bottom navigation** — On narrow screens, a bottom nav bar provides access to Sessions, Git Diff, and Explorer tabs, plus a floating action button for new sessions
- **Quick-action buttons** — Pre-mapped touch buttons for common terminal inputs: arrow keys, Enter, y/n, Ctrl+C, Escape, Tab, and number options 1-5
- **Mobile text input** — A text input row for typing arbitrary commands and sending them to the terminal
- **Touch scrolling with momentum** — Custom touch event handling with inertia-based momentum scrolling in terminals
- **Swipe gestures** — Swipe down on the diff file sheet to dismiss it
- **Safe area support** — Respects iOS safe-area-inset for the bottom nav and header

### Theme

- **Dark and Light modes** — Dark theme uses a Tokyo Night-inspired palette; Light theme for bright environments
- **Persisted preference** — Theme choice is saved to `localStorage` and defaults to the OS system preference

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Exit diff fullscreen → close diff panel → exit explorer fullscreen → close explorer panel → exit focus mode (priority order) |
| `Ctrl/Cmd+Enter` | Submit commit message (when commit bar is focused) |

## How It Works

1. **Session creation** — The dashboard lets you create named sessions pointed at any local directory.
2. **PTY spawning** — The server spawns the AI CLI inside a pseudo-terminal via the user's login shell (`$SHELL -l -c "exec <agent>"`).
3. **Real-time streaming** — Terminal I/O flows through Socket.io rooms. Each session is a room identified by its UUID.
4. **State detection** — The server strips ANSI codes from output and, after a 500ms settle period, analyzes the tail to classify the session as `waiting`, `running`, `idle`, or `exited`.
5. **Reconnect replay** — A 100KB rolling buffer per session allows clients to catch up on output when joining or reconnecting.
6. **Persistence** — Sessions and their display order are saved to JSON files on disk and restored on server restart.

## Development

### Project Structure

```
argus/
  shared/     # Shared TypeScript types (session models, REST shapes, Socket.io event maps)
  server/     # Express + Socket.io + node-pty backend (dev :5401, prod :5757)
  client/     # React 19 + Vite + xterm.js frontend (port 5402)
  bin/        # swarm (dev) and argus (production) launcher scripts
  scripts/    # Post-install helpers (node-pty native binary fix)
  docs/       # Screenshots and planning documents
```

### Dev Commands

```bash
npm install                   # Install all workspace dependencies
npm run dev                   # Run server + client concurrently
npm run dev -w server         # Server only (Express on :5401)
npm run dev -w client         # Client only (Vite on :5402)
npm run build -w shared       # Build shared types (do this first)
npm run build -w server       # Build server
npm run build -w client       # Build client
npm run lint -w client        # Lint client
```

Dev mode runs the API server on port 5401 (not the packaged app's 5757) so it can coexist with a production instance. Vite proxies `/api` and `/socket.io` to `:5401` transparently.

### Contributing

1. Fork the repo and create a feature branch
2. Run `npm run lint -w client` before submitting a PR
3. TypeScript strict mode is enforced throughout — avoid `any`
4. Server imports use `.js` extensions (required for ESM resolution with TypeScript)
5. Session data files (`server/data/`) are gitignored and should never be committed

### Versioning

When bumping the version, update it in **both** `package.json` (root) and the version badge in `README.md` (the shield.io badge URL on line 3 contains the version string).

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Server** | Express, Socket.io, node-pty, TypeScript (ESM, strict) |
| **Client** | React 19, xterm.js, Socket.io-client, @dnd-kit, Vite |
| **Shared** | TypeScript strict types for session models, REST shapes, Socket.io event maps |
| **Styling** | CSS custom properties (design tokens) — no CSS framework |
| **Syntax highlighting** | react-syntax-highlighter (Prism, 29 languages) |
| **Icons** | lucide-react |
| **Build** | npm workspaces, concurrently, TypeScript 5.7+ |
| **Ports** | Production: 5757 (all-in-one) · Dev: API 5401, Vite 5402 (proxy to 5401) |

---

Built for developers who run multiple AI coding agents at once.
