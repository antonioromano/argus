# Keep Awake CTA — Design

**Date:** 2026-08-04
**Status:** Approved (design), pending implementation plan

## Problem

Argus already prevents the Mac from sleeping *implicitly*: `SessionManager.refreshSleepPrevention()`
starts a sleep blocker while ≥1 shell is `running` and the `preventSleepWhileRunning` config flag is
on, and `NgrokService` does the same while a tunnel is up. There is no way to say "keep this Mac
awake for the next 2 hours" without a running shell — the Amphetamine use case (a long build in
another app, a download, a remote session you're about to reconnect to).

## Solution

A toolbar CTA in the Electron title bar, immediately left of Remote Access / Theme / Settings, that
arms a manual keep-awake window with a fixed duration ladder.

### Behavior

- **Durations:** 5 minutes, 15 minutes, 30 minutes, 1 hour, 2 hours, 4 hours, Indefinitely.
- **Blocking scope:** system *and* display stay awake — the existing behavior of
  `SleepPreventionService` (Electron `powerSaveBlocker.start('prevent-display-sleep')`, otherwise
  `caffeinate -di` on darwin / `systemd-inhibit --what=idle` on linux). No second blocker mode.
- **Expiry is server-owned.** The server holds `expiresAt` and a single timer; the client's countdown
  is display-only and never decides when to release.
- **No persistence.** An armed window dies with the app (Cmd+Q, quit, crash). No `ConfigStore` field,
  no boot-time reconcile, no stale-expiry handling.
- **Manual and automatic blockers are independent.** Turning the manual window off must not release a
  blocker that running shells are holding, and a shell exiting must not cancel a manual window.

### Chosen UI — Option B (countdown pill)

Evaluated three affordances in a browser preview (ring / pill / pulsing dot). Chosen: **pill**.

- **Idle:** plain 28×28 icon button, identical chrome to the Globe/Theme/Settings buttons
  (`iconBtn()` in `ElectronToolbar.tsx`). `Coffee` from lucide-react. Tooltip "Keep Mac awake".
- **Armed:** the button becomes an amber pill — accent border + `--accent-bg` + `Coffee` icon +
  live countdown in mono tabular digits (`H:MM:SS` above an hour, `MM:SS` below, `∞` when
  indefinite). Same shape language as the existing update pill (`ArrowUp v0.21.18`), which is the
  precedent for "a toolbar button that grows to carry text".
- The countdown field has a fixed min-width so ticking digits never jitter the tray. The tray does
  widen by ~52px on the idle→armed transition; this is a deliberate state change, accepted because
  remaining time is the primary information and the update pill already sets this precedent.
- **Menu:** built on the existing `ContextMenu` primitive (`components/primitives/ContextMenu.tsx`),
  anchored to the button's `getBoundingClientRect()`. Entries: a `{ header }` row, the seven
  durations (the active one prefixed with a check icon), a `{ separator }`, and a `danger`
  "Turn off" row shown only while armed. Rows hover with a background change only — no size change
  (repo convention: hover must not reflow rows).

**Rejected:** progress ring (zero layout shift, but remaining time costs a hover) and pulsing dot
(most consistent with the ngrok globe, but no time or progress signal until the menu opens).

**Rejected — macOS menu-bar tray icon.** Argus has no `electron.Tray` today (only
`app.dock?.setBadge`). Adding one means tray lifecycle, template icon assets at @1x/@2x, a second
native `Menu` duplicating the duration list, and a main↔server IPC bridge for state — roughly 4× the
cost of the CTA, for a window that is already always reachable. Out of scope.

## Architecture

### 1. `SleepPreventionService` — reason-based arbitration

Today the service is a single latch: `start()` / `stop()` / `active`. `SessionManager` and
`NgrokService` each construct their **own** instance (`SessionManager.ts:241`, `NgrokService.ts:47`),
so they never contend — but they also each hold a separate OS-level blocker, and neither can see the
other's intent. A third caller sharing any of those latches would let the last `stop()` silently drop
another caller's intent.

Replace the latch with a holder set:

```ts
acquire(reason: 'sessions' | 'ngrok' | 'manual'): Promise<void>
release(reason: 'sessions' | 'ngrok' | 'manual'): Promise<void>
get holders(): readonly string[]
get active(): boolean          // holders.length > 0
```

The blocker starts on the first `acquire` and stops on the last `release`. Both stay idempotent.
`start()`/`stop()` become private. Callers change:

- `SessionManager.refreshSleepPrevention()` (`server/src/services/SessionManager.ts:353`) →
  `acquire('sessions')` / `release('sessions')`.
- `SessionManager.shutdown` (`:1470`) → `release('sessions')`.
- `NgrokService` (`:98`, `:134`, `:172`, `:199`) → `acquire('ngrok')` / `release('ngrok')`.

Arbitration only works with one shared instance, so ownership moves up: `index.ts` constructs the
single `SleepPreventionService` and injects it into `SessionManager`, `NgrokService`, and
`KeepAwakeService`. This also collapses today's two independent OS blockers into one.

### 2. `KeepAwakeService` (new)

Single responsibility: own the manual window's expiry and translate it into `acquire`/`release`.

```ts
class KeepAwakeService {
  constructor(sleep: SleepPreventionService, now: () => number = Date.now)
  arm(durationMs: number | null): KeepAwakeStatus   // null → indefinite
  disarm(): KeepAwakeStatus
  get status(): KeepAwakeStatus
  onChange(cb: (s: KeepAwakeStatus) => void): void
  shutdown(): void                                  // clear timer, release
}
```

- State: `expiresAt: number | null` (`null` = off) plus `indefinite: boolean`. One `setTimeout`,
  cleared and re-armed on every `arm()`; fires → `disarm()` → notify.
- `now` is injected so expiry is testable without fake timers (`mock.timers` hangs in this repo —
  see the `TerminalMirror` note in `docs/solutions/`).
- Emits on every transition; `index.ts` wires `onChange` to a Socket.io broadcast.

### 3. Transport

**Shared** (`shared/src/types.ts`):

```ts
export interface KeepAwakeStatus {
  active: boolean;
  /** epoch ms; null when off or indefinite */
  expiresAt: number | null;
  indefinite: boolean;
}
```

plus `'keepawake:status': (status: KeepAwakeStatus) => void` on `ServerToClientEvents`.

**REST** (`server/src/routes/keepAwake.ts`, mounted `app.use('/api/keep-awake', ...)` alongside the
existing routes at `server/src/index.ts:201-206`):

- `GET /api/keep-awake` → `KeepAwakeStatus`
- `POST /api/keep-awake` body `{ durationMs: number | null }` → `KeepAwakeStatus`
- `DELETE /api/keep-awake` → `KeepAwakeStatus`

`durationMs` is validated against the seven-value allowlist (plus `null` for indefinite); anything
else is `400`. Both routes sit behind the existing bearer-token middleware, so a remote/mobile client
cannot arm the blocker unauthenticated. No filesystem paths are involved, so `pathScope` does not
apply.

**Socket:** `keepawake:status` broadcast on every transition (arm, disarm, expiry) so a second window
or the mobile client never shows a stale pill.

### 4. Client

- **`client/src/hooks/useKeepAwake.ts`** — mirrors `useNgrok`: initial `GET` via `authFetch`
  (`services/api`), socket event as the source of truth, `arm(durationMs)` / `disarm()` callbacks. A
  local 1s interval re-renders the countdown from `expiresAt`; it never mutates state and is only
  mounted while armed.
- **`client/src/app/ui/KeepAwakeButton.tsx`** — the CTA. Owns menu open state and anchoring; renders
  idle icon vs armed pill. Formatting helper `formatRemaining(ms)` lives here and is unit-tested.
- **`client/src/app/ui/ElectronToolbar.tsx`** — render `<KeepAwakeButton />` before the Remote Access
  button. `ArgusApp` passes the hook's values down, matching how `ngrokConnected` is already threaded.
- Mobile (`app/mobile/MobileApp`) is out of scope for this change.

### Data flow

```
click duration → POST /api/keep-awake → KeepAwakeService.arm()
                                          ├→ SleepPreventionService.acquire('manual') → powerSaveBlocker
                                          └→ onChange → io.emit('keepawake:status')
                                                          → useKeepAwake → pill re-renders

timer fires   → KeepAwakeService.disarm() → release('manual') + broadcast
shell exits   → refreshSleepPrevention() → release('sessions')   [manual holder unaffected]
```

## Error handling

- `powerSaveBlocker` / `caffeinate` failure: `acquire` rejects; the route returns `500` with the
  message and the service rolls back to off, so the UI never shows an armed pill over a dead blocker.
- Socket disconnect: the pill keeps counting down from the last known `expiresAt` (harmless — the
  server owns the real release) and re-syncs via the `GET` on reconnect.
- Client clock skew vs server: the countdown derives from server-sent `expiresAt`, so a skewed client
  shows a wrong number but never releases early or late. Acceptable; both clocks are the same machine.
- Duplicate arm while armed: replaces the window (new duration, timer reset) rather than stacking.

## Testing

Server (`node:test`):
1. `SleepPreventionService` — two holders acquired, release one → still active; release both →
   stopped; double-acquire of the same reason is idempotent; unknown release is a no-op.
2. `KeepAwakeService` — arm sets active and acquires; expiry via injected clock releases and notifies;
   disarm before expiry clears the timer; re-arm replaces rather than stacks; indefinite never expires.
3. Route validation — non-allowlisted `durationMs` → `400`; `null` → indefinite.
4. Regression: a manual window survives the last running shell exiting, and vice versa.

Client (Vitest):
5. `formatRemaining` — sub-minute, sub-hour, over-hour, indefinite, negative clamp.
6. `KeepAwakeButton` — idle renders a 28×28 icon; armed renders the pill with the formatted countdown;
   picking a duration calls `arm` with the right ms; "Turn off" only renders while armed.
7. `useKeepAwake` — socket event updates status; `arm` posts and does not optimistically flip state.

## Out of scope

- macOS menu-bar tray icon (rationale above).
- Persisting an armed window across restart.
- A "system awake but let the display sleep" mode.
- Condition-based windows ("while shells are running" — already covered by the
  `preventSleepWhileRunning` setting).
- Command palette entry and keyboard shortcut. `keyboardShortcuts` config makes these cheap to add
  later; deliberately deferred to keep this change to one surface.
