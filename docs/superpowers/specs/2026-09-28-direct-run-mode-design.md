# Direct run mode for agent sessions — design

**Status:** approved in conversation 2026-09-28, pending written-spec review.

## Intent

Give the user a per-session choice to run an agent **directly**, the way the ⌘T shell runs today: the server spawns the agent with plain node-pty — no argusd daemon, no tmux — so the terminal receives the agent's raw output and behaves like a plain terminal (natural scrollback, selection, copy, wheel; none of tmux's redraw or mouse-mode side effects). The trade-off is accepted explicitly: a direct session's agent stops when Argus quits and is never reattached.

Persistent sessions (daemon/tmux, survive a quit) stay exactly as they are and remain the default. The native terminal engine work for agent sessions is parked — this design does not change it; both renderers (xterm.js and native) work for direct sessions unchanged.

### Decisions (from the conversation)

| # | Question | Decision |
|---|----------|----------|
| D1 | Process model | Option A: the **server** spawns the agent directly with node-pty, exactly like the ⌘T shell (`CompanionTerminalManager`). Not a Swift-owned process. |
| D2 | After an Argus restart | The session **stays in the list as `exited`** with a Restart button; name, group, position, folder, engine, run mode kept. Nothing restarts automatically. |
| D3 | ⌘Q while a direct session runs | **Ask first**, listing only the running direct sessions, Cancel / Quit, "Don't ask again". |
| D4 | Default for new sessions | **Persistent**. Direct is opt-in per session; default configurable in Settings → Runtime. |
| D5 | Changing run mode later | **Fixed at creation.** To switch, Clone with the other mode. |

## Current state (verified in code)

- `server/src/services/ptyBackend/types.ts` — `PtyBackend` interface (`spawn`, `detach`, `stopSession`, `stopSessionAndWait?`, `stopAll`, `listSurvivors`, `isSurvivorDead`, `reapOrphans`, `seedMirror`, `writeWheel`, `isPersistent`, `ready?`, `onSessionResync?`), `kind: 'tmux' | 'daemon'`.
- `SessionManager` holds **one** backend (`this.backend`, chosen app-wide by `makePtyBackend` from config `ptyBackend: 'auto' | 'tmux'`), used at ~15 call sites.
- `PtyManager.spawn(folderPath, command, cols, rows, flags, extraEnv)` already spawns an agent with no tmux: `$SHELL -l -c "exec <command> <flags>"`. It is `TmuxBackend`'s fallback when tmux is unavailable.
- `ManagedSession.persistent: boolean` already exists per session.
- `restoreSessions()` re-creates every persisted session; a non-survivor is **re-spawned fresh** ("Restored session"). D2 requires not doing that for direct sessions.
- `restartSession(id)` detaches the old pty, stops the agent, and spawns a fresh one; it already works for an exited session.
- Quit: `electron/src/main.ts` `before-quit` shows a confirmation only when "Exit sessions on quit" (`exitSessionsOnQuit`) is on; it reads `getActiveSessionSummaries()` from `server/src/index.ts` (`{ name, status, terminalEngine? }`).

## Design

### 1. Data model and settings

- `SessionInfo` / `ManagedSession` / persisted session record gain **`runMode: 'persistent' | 'direct'`**. Missing (existing records) ⇒ `'persistent'`. Set at creation, never changed (D5). Clone copies it unless the user picks otherwise in the Clone sheet.
- `AppConfig` gains **`defaultRunMode: 'persistent' | 'direct'`** (default `'persistent'`, D4) and **`confirmQuitDirectSessions: boolean`** (default `true`, D3). Both added to `DEFAULT_CONFIG` in `shared/src/types.ts` and the server's `ConfigStore` copy (kept in sync by `check:deps`), validated in `server/src/routes/config.ts`, registered in the Settings registry (`defaultRunMode` → Runtime pane; `confirmQuitDirectSessions` → Confirmations pane) and in `RESETTABLE_KEYS`.
- The create/clone request shapes accept an optional `runMode`; the server normalizes it (unknown ⇒ the config default) at the boundary, like `terminalEngine`.

### 2. `DirectBackend`

New `server/src/services/ptyBackend/DirectBackend.ts` implementing `PtyBackend` with `kind: 'direct'` (the union widens to `'tmux' | 'daemon' | 'direct'`):

| Member | Behaviour |
|---|---|
| `isPersistent()` | `false` |
| `spawn(opts)` | `PtyManager.spawn(folderPath, command, cols, rows, flags, extraEnv)`; `attachExisting` is never true for direct sessions (guarded: treated as a fresh spawn) |
| `seedMirror` | no-op — the mirror is fed by the raw stream |
| `writeWheel(id, pty, data)` | `pty.write(data)` — no multiplexer |
| `detach(pty)` | kill the pty (a direct agent cannot outlive its client) |
| `stopSession(id)` | kill the tracked pty for `id` |
| `stopAll()` | kill every tracked pty |
| `listSurvivors()` | resolves to an empty set |
| `isSurvivorDead()` | `true` |
| `reapOrphans()` | no-op |

`DirectBackend` tracks its ptys by session id so `stopSession`/`stopAll` can reach them.

### 3. Routing

- `SessionManager` keeps the existing app-wide backend as `persistentBackend` and adds `directBackend` (constructed once).
- A private `backendFor(session | runMode)` returns `directBackend` for `runMode === 'direct'`, else `persistentBackend`. Every current `this.backend.*` call that concerns one session routes through it; app-wide operations (`stopAll` on "Quit & Stop All", `listSurvivors`/`reapOrphans` on restore, `ready`) call the persistent backend, and `stopAll` additionally stops `directBackend`.
- `ManagedSession.persistent` is derived from the chosen backend's `isPersistent()` as today; `tmuxName` stays set only for persistent tmux sessions.
- The config `ptyBackend` (auto/tmux) and `ARGUS_PTY_BACKEND` keep applying to persistent sessions only.

### 4. Restart of Argus (D2)

- `restoreSessions()`: for a record with `runMode === 'direct'`, skip the survivor lookup and **do not spawn**. Register the session as a placeholder: `status: 'exited'`, a no-op pty stub (write/resize/kill are no-ops; no data or exit events), an empty mirror, all persisted metadata kept. Log `Restored (exited) direct session: <name>`.
- Restart from the tile goes through the existing `restartSession`, which spawns via `backendFor(session)` → `DirectBackend`.
- Persistent sessions keep today's reattach behaviour unchanged.

### 5. Quit (D3)

- `getActiveSessionSummaries()` includes `runMode`.
- A pure function (e.g. `electron/src/quitPolicy.ts`, unit-tested) decides the dialog: given `{ explicitStopAll, exitSessionsOnQuit, confirmExitOnQuit, confirmQuitDirectSessions, sessions }` it returns which confirmation to show, if any:
  - the existing stop-all confirmation when it applies today (unchanged precedence — it already covers every session);
  - otherwise, when `confirmQuitDirectSessions` and at least one direct session's status is not `exited`, the new dialog listing only those direct sessions;
  - otherwise none.
- The new dialog: "Quitting will stop these direct sessions:" + names (first 10, "…and N more"), buttons Cancel / Quit, checkbox "Don't ask again" which writes `confirmQuitDirectSessions: false` through the same server setter pattern the existing dialog uses.
- On Quit, the normal detach-quit runs; `DirectBackend.detach` kills the direct agents while persistent ones survive.

### 6. UI

- Create and Clone sheets: a "Run mode" segmented choice — **Persistent** ("survives Argus restarts") / **Direct** ("like ⌘T — stops when Argus quits"), defaulting to `defaultRunMode`.
- Settings → Runtime: "Default run mode" next to the terminal engine default. Settings → Confirmations: "Confirm quitting with direct sessions".
- Tile header and Focus header: a small "Direct" marker for direct sessions.
- Everything else (state detection, notifications, diff/files, Mosaic/Focus, mobile view, both renderers) is unchanged: the server still sees the output.

### 7. Errors

- Spawn failure (deleted folder, missing shell): caught as today for the no-tmux path; the session goes `exited` with the error surfaced as for any failed spawn; Restart retries.
- Agent exits on its own: existing `onExit` → `exited`; Restart spawns fresh.

## Testing

Tests assert outcomes.

- `DirectBackend` (server, node:test): spawns through `PtyManager.spawn` (injected fake), `isPersistent()` false, `listSurvivors` empty, `detach`/`stopSession`/`stopAll` kill the tracked ptys.
- Routing (`SessionManager`): a direct and a persistent session side by side — each spawns, stops, detaches and routes wheel reports through its own backend.
- Restore: a persisted direct record comes back `exited`, is not spawned, keeps name/group/folder/engine/runMode; `restartSession` spawns it through `DirectBackend`; persisted persistent records keep today's reattach/restore path.
- Config: `defaultRunMode` / `confirmQuitDirectSessions` validated by the route; unknown `runMode` on create normalized to the default.
- Quit policy (electron, node:test): asks when a direct session runs; not when all direct sessions are exited, when `confirmQuitDirectSessions` is false, or when the stop-all confirmation applies; lists only direct sessions.
- Settings registry: new keys registered in their panes and `RESETTABLE_KEYS` (existing registry tests enforce coverage).
- Client: Create/Clone sheet sends the chosen `runMode`; the "Direct" marker renders for direct sessions.
- Live check before calling it done: in `npm run dev`, with a throwaway session: create a direct session, confirm plain-terminal scrollback/selection, ⌘Q asks and lists it, relaunch shows it `exited`, Restart starts a fresh agent.

## Out of scope

- Changing a session's run mode after creation (Clone instead — D5).
- Any history for direct sessions across a quit (the placeholder's terminal starts empty; `claude --resume` recovers the conversation).
- Further work on the native terminal engine for agent sessions (parked).
- A Swift-owned process (option B).
