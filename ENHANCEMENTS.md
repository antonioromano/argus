# Argus — Enhancement Plan

Work through these one by one. Each item is self-contained.

---

## Phase 1 — Session Awareness & Reliability

- [ ] **1A. Session Notifications** — When a session goes `waiting`, show a browser Notification, update the tab title (e.g. `(2) Argus`), and add a waiting-count badge to the Sessions tab.
  - New: `client/src/hooks/useNotifications.ts`
  - Edit: `client/src/hooks/useSessions.ts`, `client/src/components/NavTabs.tsx`, `client/src/App.tsx`

- [x] **1B. Session Restart** — One-click restart for exited sessions (preserves ID, name, folder, position in grid).
  - Server: add `restartSession(id)` to `SessionManager.ts`, add `PATCH /api/sessions/:id/restart` route
  - Client: add `api.restartSession()`, add restart button to `TerminalPanel.tsx` (only shown when `exited`)

- [ ] **1C. Session Rename** — Double-click session name to edit inline. Persisted via new `PATCH /api/sessions/:id` endpoint and broadcast via new `session:updated` Socket.io event.
  - Edit: `shared/src/types.ts`, `SessionManager.ts`, `routes/sessions.ts`, `TerminalPanel.tsx`, `useSessions.ts`

- [x] **1D. Session Restore ID Stability** *(bug fix)* — On server restart, `restoreSessions()` generates new UUIDs, breaking `order.json`. Fix: pass the persisted `id` to `createSession()`.
  - Edit: `server/src/services/SessionManager.ts` only

- [x] **1E. Atomic JSON Writes** — Write to `.tmp` then `rename()` to prevent file corruption on crash.
  - New: `server/src/utils/atomicWrite.ts`
  - Edit: `SessionStore.ts`, `OrderStore.ts`, `ConfigStore.ts`

- [x] **1F. Connection Status Indicator** — Show a banner when the WebSocket disconnects.
  - Edit: `client/src/hooks/useSocket.ts` (expose `connected`), `client/src/App.tsx` (render banner)

---

## Phase 2 — Multi-Session Productivity

- [ ] **2A. Broadcast Input** — Send the same command to multiple selected sessions at once.
  - Add `session:broadcast` event to shared types and socket handler
  - New: `client/src/components/BroadcastBar.tsx`

- [ ] **2B. Keyboard Shortcuts** — `Ctrl/Cmd+N` new session, `Ctrl/Cmd+B` broadcast bar, `Ctrl/Cmd+1–9` focus by position, `?` shortcut help overlay.
  - New: `client/src/hooks/useKeyboardShortcuts.ts`

- [ ] **2C. Session Search/Filter** — Filter bar on dashboard: search by name/folder, status-pill quick filters.
  - Edit: `client/src/components/Dashboard.tsx`

- [x] **2D. React Error Boundary** — Prevent a single component crash from killing the whole app.
  - New: `client/src/components/ErrorBoundary.tsx`
  - Wrap tab content in `App.tsx` and each `TerminalPanel` in `Dashboard.tsx`

---

## Phase 3 — Security

- [ ] **3A. Command Injection Fix** *(critical)* — Replace `execSync(\`which ${cmd}\`)` with `execFileSync('which', [cmd])` to prevent shell injection via custom agent commands.
  - Edit: `PtyManager.ts`, `AgentRegistry.ts`, `GitService.ts`, `NgrokService.ts`

- [ ] **3B. Auth Hardening** — Token TTL (24h), replace unsalted SHA-256 with `crypto.scrypt`, rate-limit login to 5 attempts/min.
  - Edit: `server/src/services/AuthService.ts`, `server/src/routes/auth.ts`

- [ ] **3C. Dynamic CORS** — When ngrok is active, add the tunnel URL to allowed CORS origins.
  - Edit: `server/src/index.ts`

---

## Phase 4 — Polish & Code Quality

- [x] **4A. Theme Change Without Terminal Flicker** — Remove `theme` from the main `useTerminal` effect; update `terminal.options.theme` in a separate effect instead.
  - Edit: `client/src/hooks/useTerminal.ts`

- [x] **4B. Diff Polling Pause on Hidden Tab** — Skip git diff polling when `document.visibilityState === 'hidden'`.
  - Edit: `client/src/hooks/useGitDiff.ts`

- [x] **4C. Dead Code Cleanup** — Delete `PathAutocomplete.tsx`, `CollapsedSessionStrip.tsx`; remove unused `@xterm/addon-webgl` dep; deduplicate hardcoded agent list in `App.tsx`.

- [x] **4D. Gitignore & Version Fixes** — Add `server/data/` to `.gitignore`; align all workspace `package.json` versions to `0.1.3`.

- [x] **4E. README Corrections** — Remove false "WebGL renderer" claim, remove `F` shortcut (deleted in `086a366`), fix placeholder clone URL.

- [x] **4F. Hardcoded Colors** — Replace hex color literals in `FolderTree.tsx` and the `ExplorerPanel.tsx` toast with CSS token variables.

- [x] **4G. Extract Session Sidebar** — Deduplicate the repeated session-list sidebar from `Dashboard.tsx`, `ExplorerPanel.tsx`, `GitDiffPanel.tsx` into a shared `SessionSidebar.tsx` component.
