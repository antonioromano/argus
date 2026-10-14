# Argus review — 2026-10-11 (v0.25.4 → branch `perf/memory-cpu`)

A full review of the app: security, bugs, performance (measured on the live app), hygiene, feature ideas
and architecture. Status: ✅ fixed and merged to `main` (PRs #18–#23) · ⏳ open or in progress.

Status updated 2026-10-13 from `main` (#18 perf/memory-cpu, #19 + #23 security, #20 client bugs,
#22 session insights). Round-2 performance and client work is in progress on other branches; those rows
stay ⏳ until they merge.

---

## 1. Measured resource profile (installed app: 7 sessions, 2 busy, 46h uptime)

| Process | Footprint | CPU |
|---|---|---|
| Argus main (server, mirrors, StateDetector, native overlay) | 719 MB (peak 1006 MB) | ~4% |
| Renderer (active window) | 272 MB (peak 379 MB) | ~20% |
| GPU helper | 204 MB | ~20% |
| Second renderer | 141 MB | ~0% |
| argusd | 26 MB | ~0.3% |

**Where main's 719 MB goes** (`vmmap --summary`):

- **JS heap: ~117 MB** (V8/PartitionAlloc tags 253 and 255).
- **Native: ~530 MB of `CG image` (286 MB) + `CoreAnimation` (244 MB).** Almost all of it is compressed or
  swapped (0 KB resident). Only ~58 MB of main's private memory is dirty and resident.
  - Ruled out with a minimal Electron repro: window vibrancy (39 MB either way), icons, tray.
  - Leading suspect: the native SwiftTerm overlay's layer and image buffers (one `native` session was open).
  - ⏳ **Confirm:** close the native tile, re-measure with `footprint <pid>` and `vmmap --summary <pid>`.

**Benchmarks** of the server terminal pipeline (scratchpad harness against `server/dist`):

| Measure | Before | After |
|---|---|---|
| Live mirror memory (5000 rows × 200 cols) | ~14 MB each | ~14 MB each (exited sessions now freed) |
| `serialize()` on a repeat join | 40–48 ms, synchronous | **0.001 ms** (cached) |
| StateDetector cost over the mirror-only floor | ~44 µs per chunk | **~9 µs per chunk** |
| Blocking `tmux send-keys` per wheel event (tmux fallback only) | 5.4 ms | async, coalesced |

**Leaked agents.** The dev data dir had **two argusd daemons running the same 3 session ids**. That is 6
`claude` processes at ~145 MB each (~880 MB), idle for 5 and 10 days.
- Cause: the daemon socket name comes from an env label, not from the data dir. A launch without
  `ARGUS_TMUX_SOCKET` started a second daemon (`argusd-argus.sock`) on `argus-dev`, and that daemon
  re-spawned the same sessions.
- ✅ Now detected and logged loudly (`findDuplicateDaemons`, `ptyBackend/index.ts`).
- ⏳ The stale dev daemons (pids 63260 and 70443) still need killing by hand.
- ✅ argusd holds an exclusive per-data-dir lock (`<dataDir>/argusd.lock`), and the server adopts a daemon
  already live on its data dir instead of starting another (`chooseDaemonSocket`, #18).

---

## 2. Security

| # | Sev | Where | Issue | Fix | Status |
|---|---|---|---|---|---|
| S1 | **CRITICAL** | `server/src/middleware/auth.ts:16` | Auth is bypassed by path case: `/API/...` skips `startsWith('/api/')`, but Express routing ignores case. Gives full unauthenticated API access over ngrok (read `.env`, write `~/.zshenv` → RCE). Reproduced. | `app.set('case sensitive routing', true)`, mount as `app.use('/api', auth)`, compare the lowercased path, default-deny | ✅ #19 |
| S2 | **CRITICAL** | `index.ts:92-108`, `socket/handler.ts:83-94` | No Origin/Host check. In default local mode, any web page can open `ws://127.0.0.1:5757`, read session ids, `ct:join` and `ct:input "curl…\|sh"`. DNS rebinding and cross-site text/plain POSTs reach REST. | Host+Origin allowlist (`allowRequest` + Express), better a per-launch token injected via preload | ✅ #19 |
| S3 | HIGH | `auth.ts:23-28`, `routes/ngrok.ts`, `handler.ts:83` | "Exposed" is only detected when Argus starts ngrok itself. Manual ngrok/cloudflared/tailscale leaves auth off. ~1s race before the flag flips; sockets that connect in that window stay authenticated. | Treat `X-Forwarded-*`/`Forwarded`/non-loopback Host as exposed; set password before the tunnel; drop unauthenticated sockets when enforcement starts | ✅ #23 |
| S4 | MED | `handler.ts:182-194` | `session:resize` is unbounded: `{cols:100000}` → mirror OOM kills Electron main | Clamp to integers (cols 2..1000, rows 2..500); same for `ct:` and `ephemeral:` | ✅ #19 |
| S5 | MED | `routes/filesystem.ts:451,474-490,503` | Delete, rename and move accept the session root → `rm -rf` of the project including `.git` | Reject `resolved === base` for destructive ops | ✅ #19 |
| S6 | MED | `launch/validateLaunch.ts:58-76`, `launchGate.ts` | Deep links pass `--mcp-config=~/Downloads/x.json`, `--settings`, `--dangerously-skip-permissions` with no warning. Ready `run/<id>` launchers start with no approval. | Deny or red-flag risky flags; require a click for external `run/` | ✅ #23 |
| S7 | LOW-MED | `routes/sessions.ts:102-119` | `folderPath` is not required to be absolute or realpath'd. A session at `$HOME` widens pathScope to the whole home dir. | Require absolute, store realpath, restrict roots for remote clients | ✅ #23 |
| S8 | LOW | `routes/git.ts:328`, `GitService.ts:937` | `baseBranch` is not validated → git option injection | `isSafeRef` + `check-ref-format` | ✅ #23 |
| S9 | LOW | `GitService.ts:1125` | `.gitignore` append keeps newlines (rule injection) | Reject CR/LF, write a repo-relative `/path` | ✅ #23 |
| S10 | LOW | `handler.ts:197-228` | Ephemeral terminal ids are chosen by the client and not tied to the socket (and the client never uses the feature) | Remove it, or key by `socket.id` | ✅ #23 (API removed) |
| S11 | LOW | `AuthService.ts:34`, `handler.ts` | Tokens are not cleared on password change; sockets are never re-checked after the handshake | Clear tokens; re-check periodically | ✅ #23 |
| S12 | LOW | `routes/auth.ts:111` | All tunnel users share one rate-limit bucket (lockout DoS) | Per-IP behind the tunnel + global cap | ✅ #23 |
| S13 | LOW | `routes/filesystem.ts:206` | Per-route 2 MB body limit never applies (global 10 MB parser runs first) | Per-route parsers | ✅ #23 |
| S14 | LOW | `electron/src/main.ts:1021-1219` | IPC handlers (`native-term:*`, `dialog:showMessageBox`, `menu:set-shortcuts`, `app:relaunch`) neither check the sender nor validate payload shape | Shared `assertTrustedSender` + shape guards | ✅ #23 |
| S15 | LOW | `electron/afterPack.cjs:41-48` | Fuses `OnlyLoadAppFromAsar` and `EmbeddedAsarIntegrityValidation` are off; the "deferred" comment in `electron-builder.config.cjs` is stale | Flip them; re-check the entitlements | ⏳ stale comment fixed (#23); fuses still off until a packaged boot with them on is verified (see `afterPack.cjs`) |

Done well, don't redo: agentType registry guard and `shquote`; `execFile` with `--` everywhere; pathScope
realpath re-check; sandboxed renderer; launch IPC sender checks; HMAC agent-signal tokens; serialized
session persistence.

---

## 3. Performance & reliability

| # | Impact | Issue | Status |
|---|---|---|---|
| P1 | HIGH | Git-dirty poll: serial, not deduped per folder, takes `index.lock` (collides with the agent's `git commit`) | ✅ `--no-optional-locks` on all read-only status calls; folder dedupe; concurrency 4 |
| P2 | HIGH | Full 5000-row `serialize()` (~45 ms, synchronous) on every join, resync and dedup | ✅ cached per write generation |
| P3 | HIGH | One ~14 MB mirror per session for its whole life, including exited sessions | ✅ exited sessions frozen to a string 5s after exit, mirror and watcher disposed. ⏳ idle-unviewed tiering |
| P4 | HIGH | Restore: ~10 sync tmux calls + a full `sessions.json` rewrite per session | ✅ one persist at the end; mouse config once per tmux server. ⏳ batch `list-panes -a`, async tmux |
| P5 | MED-HIGH | StateDetector: full classify (~90 row reads) per chunk | ✅ classify only when settled, rows read once (−80% detector overhead) |
| P6 | MED | Legacy `outputBuffer` re-copied 100 KB per chunk | ✅ removed; 16 KB chunked `RawTail` kept for diagnostics |
| P7 | MED | `ct:output` / `ephemeral:output` emit once per chunk (the starvation pattern) | ✅ 16 ms coalescer, flush-before-join and flush-before-exit |
| P8 | MED | `ChangelistStore`/`CommitSelectionStore`: sync `git rev-parse` per request | ✅ async with a 30s cache (`utils/gitRoot.ts`) |
| P9 | LOW (tmux fallback) | Blocking `tmux send-keys` per wheel event (5.4 ms × 60–120/s) | ✅ async, coalesced per 16 ms |
| P10 | MED-HIGH | Daemon: one shared 8 MB outbox; overflow drops the connection and reseeds every session (cascade) | ⏳ per-session flow control |
| P11 | MED | Daemon: input writes and the 30s replay run on the single read goroutine (head-of-line blocking) | ⏳ writer goroutine per session |
| P12 | MED | One recursive FSEvents stream per session, `node_modules` filtered in JS | ⏳ refcount per root (exited sessions now stop theirs) |
| P13 | LOW | `ring.go` copies byte by byte; `DaemonClient` re-concatenates buffers on every chunk | ⏳ |
| P14 | — | Renderer + GPU ~40% CPU with 2 busy sessions | ✅ re-render storm fixed (see C4). ⏳ take a renderer perf trace to find what's left (spinner repaints, animations) |
| P15 | — | ~530 MB of native image/layer memory in main | ⏳ see §1 |

Independent review of the fix diff found 4 issues (restart racing the exited-tier freeze, no re-arm after a
reseed, companion coalescer leak on destroy, minimize lost on unmount); all fixed with regression tests.

**Structural (⏳):** move the mirrors and StateDetector into a `utilityProcess`. Profiling shows the JS heap
is only ~117 MB at 7 sessions, so the main win is keeping parse and serialize off the main thread. It
matters from ~25 sessions up; deferred until the native-memory question (P15) is settled.

---

## 4. Client bugs

| # | Sev | Where | Issue | Status |
|---|---|---|---|---|
| C1 | HIGH | `hooks/useTerminal.ts:385` | Un-cancelled rAF re-joins a session room after `session:leave`: a leaked subscription that receives output forever | ✅ (+ companion terminal; test) #18 |
| C2 | HIGH | `hooks/useFileBuffer.ts:136-163` | Typing during an in-flight save is marked clean → silent data loss on tab close | ✅ #20 |
| C3 | HIGH | `hooks/useGitDiff.ts:109` | The change check leaves out untracked files → new files never appear in the Diff view | ✅ #20 |
| C4 | MED-HIGH | `FontSettingsContext.tsx:30`, `SessionMenuProvider` | Context values change identity every render → every tile and terminal re-renders on each session update | ✅ (+ `ToastProvider`; tests) #18 |
| C5 | MED | `MonacoPane.tsx:113`, `registerSymbolProviders.ts` | Go-to-definition uses a global active path → wrong in a split editor | ✅ #20 |
| C6 | MED | `hooks/useFileTree.ts:134-208` | A failed folder fetch spins forever; unhandled rejections | ✅ #20 |
| C7 | MED | `hooks/useGitDiff.ts:48,167` | Manual `refresh()` dropped while a poll runs (stale stage/unstage); `expandFileContext` spinner can stick | ✅ #20 |
| C8 | MED | `hooks/useSessions.ts:23` | REST snapshot overwrites newer socket deltas on reconnect | ✅ #20 |
| C9 | MED | `primitives/Toast.tsx` | Error toasts vanish after 1.5s, can't be dismissed, polite role (fails WCAG 2.2.1) | ✅ #20 |
| C10 | LOW | `views/Mosaic.tsx:174` | Minimize/restore timers never cleared | ✅ #18 |
| C11 | LOW | `useFileTree.ts:50` | `treeCache` never evicted for deleted sessions | ✅ #18 |
| C12 | LOW | `useFileBuffer.ts:124,187` | Double `flush()` on unmount | ⏳ |
| C13 | LOW | `TerminalShell.tsx:405` | The search bar's subscription stays on a disposed addon after a terminal rebuild | ⏳ |
| C14 | LOW | `useCompanionTerminal.ts:147` | `ct:join` spawns at 120×30 before the real size arrives | ✅ #20 |
| C15 | LOW | `useNotifications.ts:61` | Every window notifies for all sessions (multi-window) | ⏳ verify |
| C16 | ? | split editor | The same path open in both groups shares one Monaco model; closing one tab may dispose it under the other | ✅ confirmed and fixed: models ref-counted per path (#20) |

---

## 5. Hygiene

- **Docs:**
  - `ENHANCEMENTS.md` is badly stale: 1A, 1C, 2B, 3A, 3B and 3C are done, and every file it names is gone.
    Replace it with this file, or delete it.
  - `CLAUDE.md` still describes tmux as the main backend; argusd is the default.
  - `CLAUDE.md`'s release recipe stages 2 files, but `sync-versions` edits 5.
  - `README.md:185,206` still says bundled tmux.
- **Release:**
  - The x64 DMG is never smoke-booted.
  - `lint`/`build`/`test` run twice.
  - The cask bump pushes to `main` with `GITHUB_TOKEN`, which breaks under branch protection.
- **xterm split:** client on 5.5, server mirror on headless 6.0, so two parser generations read one stream.
  Align on 6.x.
- **`patch-xterm-headless.mjs`** only runs in postinstall. Make `check:deps` assert the patch markers.
- **Unused deps:** `ansi-to-html`, `dompurify`, `@types/dompurify`. `uuid` has one call site
  (use `crypto.randomUUID`). `@types/react-syntax-highlighter` is in `dependencies` instead of
  devDependencies. Two highlighters (react-syntax-highlighter + Monaco).
- **Wrong link:** "Argus on GitHub" points to `github.com/antonio/argus` (`main.ts:903`).
- **Raw NUL byte** in `client/src/hooks/useFileTree.ts` (offset 505) → git treats the file as binary.
  Use the `'\0'` escape.
- **Bare `fetch`** in `terminalMouse.ts:256` (debug only).
- **Untested:**
  - `middleware/auth.ts` (S1 would have been caught), `LoginRateLimiter`, `routes/worktrees.ts`,
    `routes/ngrok.ts`, `index.ts` wiring.
  - Electron: `main.ts` IPC, `window.ts`, `preload.ts`.
  - Client: `terminalMouse.ts`, most hooks, `app/mobile/*`.
- **Hard-won lessons** live in personal memory notes, not `docs/solutions/`; port them.
- **God files:**
  - `SessionManager.ts` (~2000 lines): split into lifecycle, output pipeline, git-watch, signal arbiter.
  - `electron/main.ts` (1640 lines): per-domain IPC registrars.
  - `ArgusApp.tsx` (1137 lines): extract `useGlobalShortcuts`, `useMenuBridge`, `<AppOverlays>`.

---

## 6. Feature ideas (checked: not already implemented at review time)

| # | Idea | Effort | Plugs into |
|---|---|---|---|
| F1 | ✅ #22 **Cost / token / context-% meter per tile.** The hooks already carry `transcript_path`; read the JSONL `usage` blocks | M | ClaudeHooksAdapter, SessionInfo, SessionCard |
| F2 | ✅ #22 **Resume instead of restart** (`claude --resume <id>`); needs the session id from hooks | S | ExitedCard, `restartSession` |
| F3 | ✅ #22 **Waiting inbox:** every pending prompt in one list, one-key approve and jump | S | StateDetector prompt extraction, CommandPalette |
| F4 | ✅ #22 **Broadcast input** to N selected sessions (`/compact`, "rebase on main") | S | `socket/handler`, Mosaic multi-select |
| F5 | **Auto-approval rules** via a PreToolUse hook decision, per folder or launcher | M | ClaudeHooksAdapter, Settings |
| F6 | **Activity timeline** from PostToolUse, SubagentStop and PreCompact hooks | M | agentSignals, a new EventStore |
| F7 | **PR/CI chip** per worktree session (`gh pr view`) | M | GitService, git poll |
| F8 | **Worktree lifecycle:** done → commit, push, open PR, delete; flag stale worktrees | M | `routes/worktrees`, MergePreviewSheet |
| F9 | **Cross-session search** of scrollback and transcripts (⌘⇧F) | M | TerminalMirror, ripgrep util |
| F10 | **Multi-session templates** (one link spawns API + client + reviewer, each in a worktree) | M | LaunchService, launchers |
| F11 | **Idle auto-suspend** to free mirrors and agents, paired with F2 | M | StateDetector, DaemonBackend |
| F12 | **Agent handoff:** new session seeded with a summary + diff | M | LaunchService, transcript reader |
| F13 | **Session chains** ("when A goes idle, send P to B") | M-L | arbiter transitions, F4 |
| F14 | **MCP control server** so an orchestrator agent can drive the fleet (after S1/S2) | M | AuthService |
| F15 | **Headless remote host mode** (server + argusd on a dev box) | L | `index.ts`, PtyBackend |
| F16 | **Orphan/duplicate agent janitor:** list sessions held by daemons of other profiles or labels, offer to kill (see §1) | S | `findDuplicateDaemons` |

---

## 7. Architecture

1. **Hooks as the source of truth for state.** Hooks give full coverage for Claude and Gemini; keep the
   622-line output scraper only as a fallback. Capturing `session_id`, `transcript_path` and tool events
   unlocks F1–F6.
2. **Fewer terminal layers.**
   - Today: 3 pty backends (argusd, tmux, direct) and 3 parsers of the same output (headless xterm 6,
     DOM xterm 5, SwiftTerm).
   - Make argusd the single source of screen state, set a date to retire tmux, and pick one renderer.
3. **Bundle the server with esbuild** into one file. That removes the "missing dep crashes the DMG"
   class that `check:deps` guards against.
4. **Always require a token, even on localhost** (fixes S2 and S3 at the root, and makes F14/F15 safe).

---

## 8. Suggested order

1. ✅ **S1 + S2** (critical, small).
2. ✅ S3–S5 → ✅ C2, C3 → ⏳ kill the duplicate dev daemons.
3. Confirm the native-memory suspect (P15) → renderer trace (P14).
4. ✅ F1 + F2 → ✅ F3 + F4 (#22).
5. Daemon flow control (P10, P11) → utilityProcess move.
