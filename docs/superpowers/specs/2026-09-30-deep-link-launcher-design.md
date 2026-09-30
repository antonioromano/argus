# Deep-link launcher (`argus://new`, `argus://run`) — design

**Status:** approved in conversation 2026-09-30; revised after the multi-persona spec review the same day. Nothing built.

## Intent

Let any local tool open an agent session in Argus from a link. The first client is the JarvAR dashboard's "refresh" button, a static `file://` page that cannot spawn processes. It already has a `jarvar://` handler that opens Terminal.app. Argus adds a tile instead of a loose Terminal window, with state detection, attention signals and the session in the same place as the rest of the work. And one grammar serves any future local tool, not just the dashboard.

Two link kinds:
- **`argus://new?…`**: carries everything a session needs (agent, folder, flags, initial prompt, engine, run mode, name, worktree). It can come from remote content (web page, email, Slack, a rendered README), so it **always** creates a *pending launch* card. Nothing runs until the user clicks **Start**.
- **`argus://run/<id>`**: starts a **launcher** the user saved from an approved card. Saving the launcher is the act of trust. It stores the exact request and the resolved agent command, so a run link carries only an id and remote content can't change what it runs.

### Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | URL shape | Generic `argus://new?…` (every `CreateSessionRequest` field, plus `prompt`) **and** `argus://run/<id>` for saved launchers. |
| D2 | Gate | Staged approval inside Argus (pending card + Start), not a native modal and not "sanitize only". |
| D3 | One-click for known links | **Launchers**, not exact-link hashes. `new` links are never trusted. "Save as launcher" on an approved card creates `run/<id>`, which auto-starts. |
| D4 | Flags | **No automatic classification.** The card lists every argument on its own row and the user decides. There is no dangerous-flag list. |
| D5 | Folders | **Warn only.** Any existing folder is allowed. The card warns when the folder is outside the configured roots or contains agent config that will load. |
| D6 | UI | Full card spec (§4): placement, states, long content, keyboard and screen-reader access, in-app errors, notification when Argus isn't frontmost, focus a live tile instead of spawning a duplicate. |
| D7 | Safe testing | Dev keeps its own scheme `argus-dev://` (already in `main.ts`); fix its macOS registration (§7). Installed app ignores `new` and `run` until the release that ships them. |

## Current state (verified in code, 2026-09-30)

- Scheme: `electron-builder.config.cjs:29` registers `argus` for the packaged app. `electron/src/main.ts:63` sets `SCHEME = app.isPackaged ? 'argus' : 'argus-dev'`. `main.ts:1280` calls `setAsDefaultProtocolClient(SCHEME)`.
- `open-url` (`main.ts:1284`) only handles `<SCHEME>://notif/<uuid>`. Anything else fails `SESSION_ID_RE` and is silently ignored, so today's installed app is inert to `argus://new`.
- `argus-dev` is **not registered in LaunchServices** on the dev machine (`lsregister -dump`: only `argus:` → `/Applications/Argus.app`). macOS only honours schemes declared in the bundle `Info.plist`, and dev runs the stock `node_modules/electron/dist/Electron.app`. The dev notification path sends `notif:click` directly (`main.ts:464`), so this was never exercised.
- `CreateSessionRequest` (`shared/src/types.ts:185`): `folderPath, name?, agentType?, flags?, worktreeBranch?, worktreeBase?, terminalEngine?, runMode?`. No prompt.
- `POST /api/sessions` validates flags with `FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9\-_.=:,/]*$/` (`server/src/routes/sessions.ts:10`): no spaces, and each entry must start with `-`. So a flag value must be joined (`--model=opus`), never a separate entry. (`routes/config.ts:14` allows spaces. The two patterns differ.)
- Spawn paths: `PtyManager.buildAgentCommand` (`PtyManager.ts:218`, tmux), `PtyManager.spawn` (`:418`, direct and tmux fallback), `DaemonBackend.ts:67`. All three shell-quote every `flags` entry and append it after the command.
- `PersistedSession` (`persistence/SessionStore.ts:6`) stores `flags`. `restoreSessions()` (`SessionManager.ts:1710`) and `restartSession()` (`:747`) respawn from the stored flags.
- Electron main imports the server in-process (`main.ts:763`) and wires server functions as module-level hooks (`hostMergeAllFn`, `getWindowRegistryStateFn`, `main.ts:1195`).
- Built-in agents: `claude`, `gemini`, `codex` (`services/AgentRegistry.ts`).
- Signal injection: `createSession` (~`SessionManager.ts:569-606`) runs `buildSignalInjection(id, agentType, resolvedFlags)` and spawns `inj?.flags ?? resolvedFlags`.
  - `ClaudeHooksAdapter` parses `--settings` / `--settings=…` out of the flags and appends `--settings <path>`.
  - `CodexNotifyAdapter` skips injection when an entry starts with `notify=`, and otherwise appends `-c notify=…`.
  - These adapters parse every flags entry.
- `PUT /api/config` (`routes/config.ts`) builds the saved object from an explicit allowlist of keys, and `ConfigStore.save` is a plain atomic write. **A key missing from that allowlist is deleted on the next Settings save** (the route's own comment ~L113 records this happening to `defaultTerminalEngine`).
- `POST /api/sessions` also rewrites the sticky `config.agentFlags[agent].enabled` defaults from each created session's flags (`routes/sessions.ts` ~L131-141).
- `DEFAULT_CONFIG` is already registered in `scripts/check-dep-sync.mjs` `DUPLICATED_OBJECTS`; adding a key to both literals is enough.
- Startup order in `main.ts`: `startServer()` resolves (~L1173) **before** `createAppWindow('main')` (~L1233). The renderer loads asynchronously after that. `deliverNotifClick` already waits for `did-finish-load`.
- Existing electron tests cover only extracted pure modules (`quitPolicy.ts`, `menuShortcuts.ts`, `menuAcceleratorGating.ts`); `main.ts` itself is not unit-tested.

## Design

### 1. URL grammar

```
<SCHEME>://new?agent=claude
              &folder=~/development/projects/jarvar
              &prompt=refresh%20dashboard
              &flag=--model=opus&flag=--verbose     (repeatable, order kept)
              &engine=native|web
              &mode=persistent|direct
              &name=JarvAR%20refresh
              &worktree=feat/x&base=main
```

| Param | Maps to | Validation |
|---|---|---|
| `agent` | `agentType` | required; must exist in `AgentRegistry` (existing command-injection guard) |
| `folder` | `folderPath` | required; `~` expanded; must be absolute and an existing directory after `realpath` |
| `flag` | `flags[]` | parser checks shape only; server `validateLaunch` runs the **existing** `validateFlags` (exported from `routes/sessions.ts`, so there is no copy to drift) |
| `prompt` | new `initialPrompt` | optional; ≤ 4096 chars; first non-whitespace char must not be `-` (no option injection, §2); no control chars except `\n`; no Unicode format chars (bidi overrides, zero-width); the double-quoted form used on the tmux path must stay ≤ 12 KB (tmux caps one command near 16 KB) |
| `engine` | `terminalEngine` | `web` or `native` |
| `mode` | `runMode` | `persistent` or `direct` |
| `name` | `name` | ≤ `SESSION_NAME_MAX` (60); no control or format chars |
| `worktree`, `base` | `worktreeBranch`, `worktreeBase` | git ref-name check; `base` only with `worktree` |

`folder` also rejects control and format chars.

```ts
interface LaunchRequest {
  agent: string; folder: string; flags: string[]; prompt?: string;
  engine?: TerminalEngine; mode?: RunMode; name?: string;
  worktree?: string; base?: string;
}
```

Rules for `new`: Any unknown param, a repeated singleton param, or a URL > 8 KB rejects the whole link. Parsing uses `URL` + `URLSearchParams` (decoding once). The parser is a pure function `parseLaunchUrl(url, scheme) → { ok: true, request } | { ok: false, error }` in `electron/src/launchLink.ts`, unit-tested like `menuShortcuts.ts`.

`run/<id>` (§3) takes no query params. `notif/<uuid>` keeps its current behaviour; `open-url` routes on the host.

### 2. Initial prompt: first spawn only

- `SessionManager.createSession` gains an optional `initialPrompt`.
- Each agent definition gains a `promptArgs(prompt) → string[]`: `claude` → `[prompt]`, `codex` → `[prompt]`, `gemini` → `['-i', prompt]` *(the codex and gemini forms still need checking against each CLI's `--help`)*. Custom agents get an optional `promptFlag` in settings; with none, a prompt is rejected at validation time rather than dropped.
- The prompt is appended **after** signal injection, so no adapter ever parses prompt text: `const spawnFlags = [...(inj?.flags ?? resolvedFlags), ...(initialPrompt ? promptArgs(initialPrompt) : [])]`. `buildSignalInjection` and `ManagedSession.flags` keep using the original `resolvedFlags`. All three spawn paths already quote every entry, so no backend changes.
- The prompt can't start with `-` (§1), so it can never be read as a CLI option. The quoting stops shell injection; this rule stops option injection.
- "First spawn" = the `createSessionFromLaunch` call (§4), for both `new` approvals and `run` launchers. It is the **only** caller that passes `initialPrompt`. `restoreSessions()` and `restartSession()` re-enter `createSession` with the stored flags and never pass it. `ManagedSession.flags` and `PersistedSession.flags` keep the original flags, and `initialPrompt` is never persisted. That keeps an Argus relaunch from re-running the refresh.
- `initialPrompt` is **not** added to the REST or Socket.io request shapes (`CreateSessionRequest` stays as is). Only the in-process launch export accepts it. With `createSession` already at 12 positional params, pass it on the launch path through an options object.

### 3. Link handling (the gate)

Pending launches are **not sessions**. They live in Electron main memory, never on disk, and never reach the server's session list or REST/Socket.io. That puts them out of reach of the ngrok and mobile surfaces, and they vanish on quit.

```
PendingLaunch { id: uuid, request: LaunchRequest, command: string, args: string[],
                warnings: Warning[], source: 'new' | 'run', launcherId?: string,
                state: 'pending' | 'starting' | 'error' | 'expired', error?: string,
                receivedAt: number, windowId: string }
Warning = { kind: 'worktree' | 'folder-outside-roots' | 'folder-agent-config'
                  | 'launcher-changed', detail: string }
```

The gate logic lives in a pure module, `electron/src/launchGate.ts`: `createLaunchGate({ now, validate, findLauncher, liveSessionForLauncher, create, notify })` with `enqueue / approve / discard / expire / list`. `main.ts` only wires it (same pattern as `quitPolicy.ts`), so it is unit-testable.

**Common steps** (both link kinds):
1. **Cold start:** until the main window exists, its renderer has fired `did-finish-load`, **and** `restoreSessions()` has settled, push the URL to `pendingUrls[]`. Then drain. (`startServer()` resolves before any window exists.)
2. `parseLaunchUrl` fails → in-app error toast (§4) naming the error **class** (unknown param, bad agent, …), never echoing URL text; at most one per 10 s, then "N invalid links ignored".
3. Server-side validation via a new export `validateLaunch(request)`:
   - agent exists, folder is a directory, flags pass `validateFlags`, agent supports a prompt if one was given
   - returns the display command (agent command plus user-visible args, Argus's injected `--settings` / `-c notify` omitted, built with the same `shquote` as `PtyManager.ts`) and the `args` list
   - returns warnings:
     - `folder-outside-roots`: realpath not under any of `config.launchFolderRoots`, default `['~/development']`
     - `folder-agent-config`: folder holds `.claude/`, `.mcp.json` or `CLAUDE.md`, listed by name, "this config loads when the agent starts"
     - `worktree`: "creates branch `feat/x` from `main`"

**`new` links** → always add a `PendingLaunch` (dedupe: an identical request already pending just refocuses it).

**`run/<id>` links** (`id` must match `^[a-z0-9-]{1,40}$`, no query params):
- Unknown id → error toast "No launcher `<id>`" (the id is echoed only after it passes the regex).
- A live (not `exited`) session created from this launcher exists → focus and highlight that tile; no spawn. A double-click or impatient re-click can't pile up sessions.
- The launcher's stored `agentCommand` ≠ the agent's current resolved command, **or** the folder's agent-config files differ from `folderConfigAtSave` → pending card with a `launcher-changed` warning and an "Update launcher" option. A remote config change to a custom agent, or hooks dropped into the folder later, can't silently change what a saved launcher runs.
- Otherwise → create directly through `createSessionFromLaunch` (§4). Toast "Started `<label>` · View" plus the tile highlight. A failure turns into a pending card in `error` state.

**Target window:** the focused Argus window, else `main`; `showWindow()` if hidden. `launch:pending` is only a refresh hint. The card stack reads state from main with `launch:list` (`ipcRenderer.invoke`) on mount and on each hint, so a renderer reload or a late window never loses a card. If a card's window closes, the card moves to `main`.

**Not frontmost:** when a card arrives and no Argus window is focused, post a system notification through the existing notification pipeline ("Launch waiting for approval: `<label>`"). Clicking it focuses the card's window. The dock badge shows the pending count.

Limits: at most 5 pending (a sixth → toast "Too many pending launches, link ignored"); pending expires after 10 min into the `expired` state; more than 3 links in 10 s → the rest are dropped with one log line.

### 4. Approval card

**Placement:**
- A fixed stack anchored below the window toolbar, overlaying the tile area (layout never reflows), in Mosaic and Focus.
- At most 2 cards are visible, plus a "+N more" row.
- New cards append at the **bottom**, so an existing card's buttons never move under the cursor.
- The stack follows the overlay suppression contract (`hooks/overlaySuppressionContract.test.ts`): while a modal Sheet is open it collapses to a badge and expands when the sheet closes.

**Content** (top to bottom):
- **Header:** agent · label or `basename(folder)`.
- **Folder:** full realpath.
- **Arguments:** **every argument on its own row**, in spawn order, monospace. Argus doesn't classify them; the user decides. Engine / mode / name are shown as a small metadata line.
- **Prompt:** a separate labelled block with a character count. Newlines are rendered visibly (`⏎` + line break); max height 6 lines with internal scroll and a "Show all" expander. Never truncated without an explicit "N more characters".
- **Full command:** in a collapsed "Command" disclosure (the exact display string from `validateLaunch`).
- **Warnings:** one row each, icon + text, never colour alone.
- **Footer (sticky):** Discard · Start, plus "Save as launcher" (id field prefilled with a slug of the name or folder basename, label field). "Save as launcher" is disabled with helper text when a worktree is present ("a launcher would create the same branch every run"). After saving, the card shows the `run/<id>` link with a Copy button.
- All text is rendered as text (never HTML). Control and format chars are already rejected at parse time (§1).

**States:**

| State | Look |
|---|---|
| pending | Start enabled after the delay |
| starting | buttons disabled, spinner, "Starting…" |
| error | card stays, inline error, Retry · Discard |
| expired | muted, "Expired", Dismiss; stays until dismissed |

**Start delay:** per card, 1 s with a visible fill. It restarts when the window regains focus and whenever the card's position changes.

**Keyboard and screen reader:**
- The stack is an `aria-live="assertive"` region announcing "Launch request: `<agent>` in `<folder>`".
- Focus is **not** moved into the card automatically (the user may be typing in a terminal). The command palette entry "Review pending launch" focuses the first card.
- Tab order: prompt, arguments, Save as launcher, Discard, Start.
- Start is `aria-disabled` (not removed) during the delay, and is **never** the default-focused or Enter-activated button. Esc discards only when the card has focus.

**Errors elsewhere:** bad links and unknown launchers use an in-app toast in the target window (with "Copy link"). No native dialogs. With no window yet, they queue with the URLs (§3 step 1).

**Reuse:** the card composes the `Button`, `Code`, `Badge`, `Toast` and `States` primitives from `client/src/components/primitives`. The Settings pane is built from `Section` / `SettingRow` like `ConfirmationsPane`.

**IPC:**
- `launch:approve {id, saveAs?: {id, label}}` / `launch:discard {id}` / `launch:list` / `launcher:rename {id, label}` / `launcher:delete {id}` go through preload to main.
- **Approval and launcher writes exist only over IPC. There is no REST route, so remote clients can't approve or create launchers.**
- The main-process handlers:
  - check the sender is an Argus app window (`event.senderFrame` URL / known `webContents` id)
  - check ids against the pending map or the launcher store
  - reject approval while the sender window is unfocused

**On approve:**
1. Main calls a new server export `createSessionFromLaunch(request, { launcherId? })`. It wraps `manager.createSession(…)`, passing `initialPrompt` through an options object, and assigns the session to the approving window.
2. If `saveAs` is set, it calls `addLauncher(…)` (§5).
3. Main removes the pending entry and highlights the new tile through the existing `notif:click` glow chain.
- Launch-created sessions do **not** update the sticky `config.agentFlags` defaults that `POST /api/sessions` maintains.
- `launcherId` is stored on `ManagedSession` and `PersistedSession` (metadata only), so the focus-if-live check also works after an Argus restart.

### 5. Launcher store

```
Launcher { id: string /* ^[a-z0-9-]{1,40}$ */, label: string,
           request: LaunchRequest /* folder realpath'd, no worktree */,
           agentCommand: string /* resolved agent command at save */,
           folderConfigAtSave: string[], createdAt: string }
```

- `AppConfig.launchers: Launcher[]` and `AppConfig.launchFolderRoots: string[]` (default `['~/development']`), added to both `DEFAULT_CONFIG` literals (the pair is already registered in `check-dep-sync.mjs`).
- `PUT /api/config` **must carry `launchers` forward explicitly**. Leaving it out of the allowlist would wipe every launcher on any unrelated Settings save (see Current state).
  - The value always comes from the current config.
  - A body-supplied array is honoured only as a **subset of current ids** (removal), and its contents are ignored: `updated.launchers = isSubsetById(body.launchers, current) ? current.filter(c => body.launchers.some(e => e.id === c.id)) : current.launchers`.
  - Additions go only through `addLauncher`, and label changes only through `renameLauncher`. Only the main-process IPC handlers call them. Otherwise a remote config write could plant or alter a launcher.
- `launchFolderRoots` is an ordinary setting (it only changes warnings).
- Duplicate id on save → the card asks to overwrite or pick another id.
- **Settings pane "Launchers"** (registered in `settings/registry.ts`, in the group holding session-creation panes [verify group name]):
  - empty state: "No launchers. Approve a launch link and choose Save as launcher."
  - each row: label, `run/<id>`, agent @ folder, created date
  - expanding a row shows the full stored args and prompt
  - actions: Copy link · Rename · Delete, with an undo toast
  - the pane also edits `launchFolderRoots`
  - a "Copy example link" button shows the `new` grammar

### 6. Security properties

- Remote content can **propose** a session with `new`, never start one. It can start only a launcher the user saved from an approved card, and only as saved: the stored command and the folder's agent config are rechecked on every run.
- The prompt is argv, quoted by the existing `shquote` paths. It never reaches a shell unquoted; tests cover `'`, `$(…)`, backticks, newlines and `;`. It can't start with `-`, so it is never read as a CLI option, and it is appended after signal injection, so no adapter parses it.
- Flags aren't classified (D4). The card's job is to show every argument clearly; judging them is the user's.
- The gate proves the user **chose to run this text**, not that the text is safe. What an approved prompt can do still depends on the agent's permission mode.
- A known `run/<id>` link can be replayed by any page. Worst case it opens the saved session, or focuses the live one.
- No approval surface over the network (ngrok, mobile); pending state never persisted.
- Out of scope: an attacker who already runs code as the user. They can call `claude` directly.

### 7. Dev scheme registration (safe testing)

- New `scripts/register-dev-scheme.mjs` (idempotent). It adds `CFBundleURLTypes → [{ CFBundleURLName: 'Argus Dev', CFBundleURLSchemes: ['argus-dev'] }]` to `node_modules/electron/dist/Electron.app/Contents/Info.plist` via `plutil`. Editing `Info.plist` breaks the bundle's code signature, so it then re-signs ad hoc (`codesign --force --deep --sign - …/Electron.app`), checks with `codesign --verify`, and runs `lsregister -f` on the bundle. It does nothing on non-darwin.
- Called from `electron:dev` (before `electron .`) and from `postinstall`, because `npm install` restores the original plist.
- Limit: with dev not running, `open argus-dev://…` launches a bare Electron window. Test with `npm run dev` running; the single-instance lock routes `open-url` to it.
- Installed v0.24.1 ignores `argus://new` and `argus://run` (host ≠ `notif`), so prod is unaffected until release.

## Testing

| Layer | Where | Cases |
|---|---|---|
| Parser | `electron/src/launchLink.test.ts` (`node:test`) | every `new` param; repeated `flag` order; unknown param; duplicate singleton; bad engine/mode; `~` expansion; oversize URL; `run/<id>` id regex and "no query params"; `notif/` untouched; wrong host; prompt starting with `-`; bidi / zero-width / control chars in prompt, name, folder |
| Validation | server `node:test` | unknown agent; missing folder; file not dir; flags failing `validateFlags`; prompt on agent without prompt support; quoted prompt > 12 KB; warnings for folder outside roots, folder with `.claude/` / `.mcp.json` / `CLAUDE.md`, worktree |
| Prompt argv | server `node:test` (per backend + `SessionManager.signalInjection.test.ts`) | quoting of `'`, `$()`, backticks, newline, `;`; prompt appended after injection (claude `--settings` and codex `notify` untouched by prompts like `--settings=/x`, `notify=x`); prompt present on first spawn; **absent after `restartSession` and `restoreSessions`**; not in `sessions.json`; `config.agentFlags` unchanged after a launch; `launcherId` persisted |
| Gate | `electron/src/launchGate.test.ts` (`node:test`) | `new` → always pending; identical pending deduped; `run` unknown → error; `run` with a live session → focus, no spawn; `run` after that session exits → spawns; `run` with a changed agent command or changed folder config → pending `launcher-changed`; `run` ok → direct; expiry → `expired`; cap of 5; burst limit; cold-start queue drains only after renderer load + restore (both outcomes); `launch:list` after reload; card re-homes when its window closes; IPC from an unknown sender, an unknown id, or an unfocused window rejected |
| Launcher store | server `node:test` | PUT without the key preserves launchers; PUT with a subset removes; PUT adding or modifying an entry is ignored; `addLauncher` duplicate id; `renameLauncher` |
| Card UI | client `vitest` | every arg on its own row; prompt block with count, visible newlines, "Show all"; warnings as icon + text; states pending/starting/error/expired; Start disabled 1 s and restarts on refocus and on position change; Start not Enter-activated; Save as launcher disabled with a worktree; `aria-live` announcement; palette entry focuses the card; stack collapses while a Sheet is open |
| Settings pane | client `vitest` | empty state; row expand shows args + prompt; rename and delete go over IPC; undo toast; roots editor |
| End to end (manual) | `npm run dev` | `open "argus-dev://new?agent=claude&folder=/tmp/argus-dl-test&prompt=hello"` → card with folder-outside-roots warning → Start → tile runs `claude 'hello'`; approve again with Save as launcher `test-hello` → `open argus-dev://run/test-hello` auto-starts; open it again while it runs → focuses the tile; add `.claude/` to the folder → next run goes to pending with `launcher-changed` |

Gate: `npm run verify` (packaging invariants live in `check:deps`).

## Rollout

1. `register-dev-scheme` + README "Testing deep links" note.
2. Parser + validation + warnings (no UI; a dev-only log line shows the parsed request).
3. `initialPrompt` plumbing + no-replay tests; `launcherId` on sessions.
4. Gate module, IPC, card UI with all states, notification when Argus isn't frontmost.
5. Launcher store, config-route carry-forward, Settings pane.
6. Manual end-to-end on `argus-dev://`; then minor release (0.25.0) per CLAUDE.md, only when asked.

First client after release: the JarvAR dashboard's Claude button. The launcher is created once from `argus://new?agent=claude&folder=…/jarvar&prompt=refresh%20dashboard&name=JarvAR%20refresh` and saved as `jarvar-refresh`. The button then links to `argus://run/jarvar-refresh` (`argus-dev://` while testing).

## Open questions

1. `codex` / `gemini` prompt argv forms: verify against each CLI's `--help` before shipping `promptArgs`.
2. `routes/config.ts` `FLAG_PATTERN` allows spaces, `routes/sessions.ts` doesn't. Align them separately; out of scope here.
3. Settings registry group for the Launchers pane, and whether "Review pending launch" also gets a keyboard shortcut.
