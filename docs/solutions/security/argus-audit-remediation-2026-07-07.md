---
title: Argus Security/Reliability Audit — Findings & Remediation
date: 2026-07-07
category: docs/solutions/security/
module: server, client, electron
problem_type: security_audit
component: full-stack
severity: critical
applies_when:
  - Exposing Argus over a network (ARGUS_HOST=0.0.0.0) or via ngrok tunnel
  - Adding new socket.io events or HTTP routes that touch pty/filesystem/git
  - Packaging/signing the Electron app or editing entitlements/fuses
  - Touching SessionManager's replay-snapshot cache or persistence queue
tags:
  - security
  - socket-auth
  - pathscope
  - electron-fuses
  - ngrok
  - reliability
  - asynchandler
---

Four-reviewer audit (2026-07-06, read-only) of server services, routes/socket/auth, client, and electron/build/CI, remediated in `fix/argus-audit-remediation` (13 implementation units, single PR, landed 2026-07-07).

## Findings and fixes

### Critical
1. **Socket.io auth bypass in exposed-but-no-password state** (`server/src/socket/handler.ts`) — the WS `io.use` gate only checked `authService.enabled`, missing the HTTP layer's fail-closed branch for `exposed && !enabled`. Effectively unauth RCE (`session:input`, `ephemeral:spawn`, companion terminals) until a password was set. **Fixed**: reject the handshake whenever `authService.enforced` and the token is missing/invalid.

### High
2. Release pipeline shipped the DMG with no gating tests/lint on tag push. **Fixed**: `package:mac` now gated behind lint/build/test.
3. Electron fuses missing (RunAsNode left enabled on a notarized build with `disable-library-validation`). **Fixed**: `@electron/fuses` applied in `afterPack`, ordered before signing.

### Medium
4. pty write-after-exit crash (`session:input` unwrapped, no `exited` guard in `writeToSession`). **Fixed**: guard + try/catch.
5. `ngrok start()` hung forever on early ngrok exit (missing authtoken etc.) — exit handler never called `pendingStartReject`. **Fixed**: mirrors `stop()`'s reject/null.
6. Symlink escape in fs path scope (`pathScope.ts` used lexical `path.resolve`, not `fs.realpath`). **Fixed**: realpath containment check with a documented residual TOCTOU gap (see below).
7. Async route handlers unwrapped → hung requests under Express 4 (rejections don't auto-forward to error middleware). **Fixed**: wrapped `sessions.ts`/`config.ts`/`git.ts` in the existing `asyncHandler`.
8. Monaco shipped in the entry chunk, loaded even on `/mobile`. **Fixed**: `React.lazy`-loaded Diff/Explorer workbenches.
9. CSP `connect-src 'self' ws: wss:` allowed the renderer to open a WS to any host. **Verified**: same-origin `'self'` already covers ws/wss; no code change needed.
10. Bare `fetch` on mobile-first calls (`getNgrokStatus`, `getAuthStatus`, `login`) broke over an ngrok free-tier tunnel (missing skip-warning header → interstitial HTML instead of JSON). **Fixed**: routed through `authFetch`.
11. "Quit & Stop All" could orphan tmux/pty on the 10s shutdown timeout. **Fixed**: escalates to `tmux kill-server` before `app.quit()` — see residual risk below (this escalation itself runs synchronously on the main thread).
12. Blocking tmux captures on every socket (re)join could stall the event loop during reconnect storms. **Fixed**: cached replay snapshots with a 250ms TTL (partial — see residual risk below).

### Low (batch cleanup, Unit 12)
- `sessions.json` writes serialized through a persist queue (mirrors the fix already applied to `StateDetector`'s writeQueue).
- `StateDetector` writeQueue now has `.catch()` so one throw doesn't permanently freeze status detection.
- Fire-and-forget sleep-prevention calls now have `.catch()`.
- `createSession`'s folderPath allowlist was **explicitly deferred** — the socket auth fail-closed fix (finding #1) already closes the practical attack path; a folder allowlist risks breaking legitimate external-drive/tmp workflows for marginal hardening gain. Revisit if Argus's exposure model changes (e.g. multi-user tunneling).
- `blameCache` size-capped (500 entries, FIFO eviction) to stop unbounded growth.
- `shell.openExternal` scheme guard anchored (`/^(https?:\/\/|mailto:)/`) to close a `https:evil` bypass.
- `session:resize` emit from the code-font-size effect gained the same `offsetWidth > 0 && offsetHeight > 0` visibility guard used at the file's other 4 fit-and-emit call sites — without it, resizing a terminal collapsed to 0×0 (a maximized workbench panel) silently resized the real tmux pane to ~2×1 and garbled it.

## Residual risks (tracked, not blocking)

- **pathScope TOCTOU**: the realpath containment check is point-in-time; a symlink swapped between the check and the actual fs write (e.g. `atomicWrite`'s `mkdir`/`writeFile`/`rename`) isn't caught. Today's only actor with session-folder write access is the pty process itself (same-user, already full-trust), so this is defense-in-depth rather than a live escalation from the remote API surface.
- **Sync tmux kill-server on quit**: `execFileSync` (including an untimed `which tmux`) runs on the Electron main thread inside the shutdown-timeout callback, risking macOS's own force-quit path defeating the escalation's goal.
- **Tmux-binary resolution duplicated** between `server/src/services/PtyManager.ts` and `electron/src/main.ts` (unavoidable — separate compilation units — but can drift silently).
- **Replay-snapshot cache not invalidated on restart** — `destroySession` clears it, `restartSession` doesn't; a client rejoining within the 250ms TTL right after a restart can get a pre-restart frame.
- **Reconnect-storm fix is partial** — the snapshot cache dedupes repeated joins to the *same* session, but a storm across many *distinct* sessions still runs blocking `execFileSync` captures serially.
- **Electron has no test harness** in this repo — the new tmux kill-server escalation and the openExternal scheme fix are unverified beyond manual testing.

## Verified clean (checked, no action)

Command injection guards (execFile + `--`, agentType registry validation, shell-quoted flags), `/set-password` loopback hardening, `timingSafeEqual` password compare, renderer sandbox/contextIsolation/no nodeIntegration, deep-link/notification UUID validation, symbols route scoping/caps.
