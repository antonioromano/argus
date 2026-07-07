# ce-review synthesis — fix/argus-audit-remediation

Run ID: 20260707-120257-2c1f03fd · Base: 02ab616a8541165ef5252ba965509c8a087595ea · Mode: autofix

## Coverage

13/13 personas dispatched and returned. 11 wrote schema JSON artifacts to this directory; `agent-native-reviewer` wrote free-text to `agent-native.txt`; `learnings-researcher` returned findings inline (no docs/solutions entry matched this diff — nothing to link).

correctness · testing · maintainability · project-standards · reliability · security · performance · api-contract · adversarial · kieran-typescript · julik-frontend-races · agent-native · learnings-researcher

## Requirements completeness (R1–R11)

| Req | Unit | Status |
|---|---|---|
| R1 network-exposed-without-password → 503 fail-closed | Unit 1 | Met |
| R2 DMG build gated on lint/test | Unit 2 | Met |
| R3 Electron fuses (disable RunAsNode) | Unit 3 | Met |
| R4 pty write-after-exit guard | Unit 4 | Met |
| R5 ngrok start() always settles + tunnel-safe fetch | Units 6, 7 | Met |
| R6 filesystem scope resists symlink escape | Unit 8 | Met, with residual TOCTOU gap (below) |
| R7 renderer cannot open WS to arbitrary host | pre-existing CSP `connect-src 'self'` | Met (no new code required) |
| R8 Monaco not in entry chunk / not shipped to `/mobile` | Unit 9 | Met |
| R9 reconnect storms don't serialize blocking tmux captures | Unit 10 | **Partial** — fixes the same-session multi-client storm; performance reviewer flags the cross-session storm still serializes via blocking `execFileSync` capture-pane calls |
| R10 "Quit & Stop All" never orphans tmux/pty | Unit 11 | Met, with a new side-effect risk (below) |
| R11 low-batch correctness/hygiene + first tests for socket auth + NgrokService | Units 12, 13 | Met; testing reviewer's gaps folded into this pass (below) |

Deferred by explicit prior decision, not a gap: Unit 12's folderPath-allowlist sub-item (see PR description).

## Findings

### Applied this pass (safe_auto → review-fixer)

1. **Font-size refit emitted `session:resize` with no visibility guard** (`client/src/hooks/useTerminal.ts`, julik-frontend-races, P1, confidence 0.85). Reclassified `gated_auto → safe_auto` in synthesis: the fix is a direct mirror of the identical `offsetWidth > 0 && offsetHeight > 0` guard already used at 4 other call sites in the same file, touches no contract/permission boundary, and closes a reproducible garbled-terminal bug (maximizing a workbench panel + bumping font size resized the real tmux pane to ~2x1). Fixed.
2. **Lazy Monaco panels lacked an ErrorBoundary around Suspense** (`client/src/app/views/Focus.tsx`, correctness, P2, confidence 0.65). Verified: already wrapped in the existing `ErrorBoundary` pattern (Unit 9's original commit) — the reviewer's finding predates that fix landing on the branch. No further action needed.
3. **`persistSessions` failure-recovery path untested** (`server/src/services/SessionManager.ts`, testing, P3, confidence 0.63). Added a test asserting a rejected `store.save()` doesn't wedge the next queued persist. Fixed.
4. **`blameCache` eviction untested** (`server/src/services/GitService.ts`, testing, P3, confidence 0.60). Added `GitService.test.ts` (new file — none existed) asserting the cache stays capped and evicts oldest-first. Fixed.

### Left unresolved — routed to downstream-resolver / human

5. **TOCTOU: symlink swap between pathScope check and mkdir/write wins race** (`server/src/utils/pathScope.ts:64`, adversarial P2 + corroborated by security P3 [suppressed standalone, confidence 0.55 < threshold, folded in here], confidence 0.68). `manual`, `human`. Concrete exploit chain in `adversarial.json`. Threat model note from security reviewer: only actor with session-folder write access today is the pty process itself (same-user, already full-trust), so this is defense-in-depth, not a live escalation from the remote API surface — but worth closing before any multi-user/tunnel exposure model.
6. **Synchronous tmux kill-server can block Electron main thread up to 3s at quit** (`electron/src/main.ts:783`, adversarial P2, confidence 0.62; corroborated by reliability + testing). `manual`, `human`. Risks macOS's force-quit path defeating the escalation's own goal.
7. **Tmux-binary resolution duplicated between `PtyManager.resolveTmux()` and `electron/main.ts`** (maintainability P2, confidence 0.78). `manual`, `human` (routing corrected from the JSON's `review-fixer` — a cross-file/cross-package extraction is not a mechanical safe_auto fix).
8. **`session:input` try/catch race guard untested** (`server/src/socket/handler.ts:129`, testing P2, confidence 0.68). `manual`, `human` (routing corrected from the JSON's `review-fixer` — this is the core of the exit-race fix Unit 4 shipped; a bad test would be worse than no test).
9. **Replay-snapshot cache not invalidated on session restart** (`server/src/services/SessionManager.ts:558`, adversarial P3, confidence 0.6). `gated_auto`, left unresolved per autofix-mode rule (only `safe_auto` auto-applies) despite being a one-line fix — flagging as the top immediate follow-up candidate.
10. **tmux kill-server escalation logic (`electron/src/main.ts`) completely untested** (testing P3, confidence 0.6). `manual`, `human` — no Electron test harness exists in this repo at all.

### Advisory / report-only (no action)

- pathScope's realpath narrowing legitimately rejects some previously-working symlink workflows with no changelog note (api-contract, P3) — recommend a release-notes line.
- `MobileApp.tsx`'s `useMemo` intentionally omits `groups` from deps (kieran-typescript, P3) — correct but undocumented; a one-line eslint-disable comment would prevent a future "fix" from reintroducing the per-render recompute this commit avoided. Not auto-applied (advisory class).
- `ngrok.ts`'s own routes weren't wrapped in asyncHandler in this PR (api-contract residual) — pre-existing, out of scope, worth a follow-up sweep alongside `filesystem.ts`/`worktrees.ts`/`update.ts`/`symbols.ts`/`auth.ts` (reliability residual, same finding independently).
- `GitService.blameCache` eviction is FIFO by insertion, not LRU (performance residual) — fine at current cap/volume, worth revisiting if usage patterns change.

## Agent-native parity

PASS — no agent-native parity gaps introduced by this PR (full report in `agent-native.txt`).

## Verdict

**Ship.** 4 safe_auto fixes applied and verified (145 server + 83 client tests green, build:all clean). No P0/P1 findings remain open — the one P1 (julik's font-size resize guard) is fixed. Residual P2/P3 work (items 5–10 above) is real but each is either pre-existing, defense-in-depth on an already-trusted actor, or requires a test harness this repo doesn't have yet (Electron) — none blocks this PR.
