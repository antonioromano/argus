# Feedback surfaces and undo

Where a message goes in Argus, and how destructive actions are guarded. Source plan:
`docs/plans/2026-10-29-004-feat-undo-destructive-actions-feedback-policy-plan.md`. Binding decisions:
`docs/plans/2026-10-29-000-ux-production-readiness-roadmap.md`. Where this file and the plan disagree,
this file wins: it records the decisions made after the plan was written.

Enforced by `client/src/policy/feedbackSurfaces.test.ts` (no `window.confirm`/`alert`/`prompt`,
no new native dialogs).

## The four surfaces

**Toast** reports something that already happened and needs no decision. It may carry one action,
usually **Undo**, **Reopen** or **Review**. Use it for success after an action whose result is not
otherwise visible, for background or async results whose origin UI is gone (menu, shortcut, startup
check), and for undo offers. Never for a result that is already visible on screen, never for an error
that belongs to a visible field or panel, never for a question. `ok` lasts 1.5 s. Action toasts last
6–10 s, pause on hover or focus, and can be dismissed.

**Inline** carries an error or warning tied to a field, row or panel that is on screen: validation,
save failure, load failure, conflict. It stays until the condition clears and sits next to its cause,
ideally with the fix as a button (Retry, Reload). Error-state components are defined by plan 003.

**Sheet (`AlertSheet`)** asks for a decision before an **irreversible** action, or a choice between
paths (Apply on next launch / Restart now). If Argus can undo the action, do not confirm it; offer Undo
instead. One primary button, destructive styling only for the destructive verb, and "Don't ask again"
only where a matching Confirmations setting exists.

**Native dialog (`dialog.showMessageBox`)** is only for app lifecycle and system-level failures: quit
or stop-all, port conflict at startup, failed self-update. Never `window.confirm`, `alert` or `prompt`
(Electron does not implement `prompt`).

**Inline two-step confirm rows** ("Delete X? Confirm / Cancel") are retired. A row action is either
undoable (act now, toast Undo) or irreversible (`AlertSheet`).

## Undo

### Two mechanisms

Both live in `client/src/utils/undoable.ts` and are driven by an action toast.

| Mechanism | Helper | When it applies | How it works |
|---|---|---|---|
| **Deferred commit** | `deferUndoable({ message, apply, commit, revert, durationMs? })` | The server cannot honestly reverse the change (re-creating would change ids or lose history), but nothing is lost by waiting. | `apply()` hides the thing now. The toast closing for any reason except its button (timeout, ✕, evicted, provider unmount) runs `commit()`. Undo runs `revert()`. A failed commit reverts and shows a `danger` toast. |
| **Snapshot restore** | `offerUndo({ message, undo, actionLabel?, durationMs? })` | The change is already committed and the caller holds an exact snapshot (git `undoId`, staged trash, `snapshotKeys(config, keys)`). | Undo runs `undo()`. A failure becomes a `danger` toast. |

`snapshotKeys(config, keys)` (`client/src/utils/configSnapshot.ts`) captures a deep-copied patch of
config keys before a bulk write (Reset all, per-pane Reset, removing a custom agent).

`peekUndo()` / `runLastUndo()` expose the newest open offer, for a command-palette entry
"Undo <last action>". There is **no global ⌘Z**: the terminal, Monaco and text inputs own it.

### Toast mechanics

`pushToast(message, tone?, { action?, durationMs?, onClose? })` returns `{ dismiss() }`.
`onClose(reason)` fires exactly once with `'timeout' | 'dismiss' | 'action' | 'evicted'`.

- At most **3** action toasts are on screen. A 4th evicts the oldest (`'evicted'`), so a deferred
  commit behind it commits instead of piling up invisibly.
- Provider unmount closes open toasts as `'dismiss'`, so pending deferred commits flush.
- A window **unload** does not flush pending commits: the thing survives the reload. That is the
  fail-safe direction.
- With no `ToastProvider` mounted, a toast closes immediately as `'dismiss'`.

### Undo windows

| Window | Applies to |
|---|---|
| **6 s** (`UNDO_WINDOW_SHORT_MS`) | Closing a session, deleting a group, deleting a list row (launcher, template, chain, auto-approval rule), removing a custom agent |
| **10 s** (`UNDO_WINDOW_LONG_MS`) | Git hunk/file discard, Explorer file delete, Reset all settings |

### Honest labels

"Undo" only for an exact restore. When only part of the state can come back, the button says what it
does. Closing a **live** session kills the agent process; its in-memory state is gone. For a Claude
session with a conversation id, the toast offers **Reopen**, which resumes the conversation
(`claude --resume`), not the in-flight work. Nothing is offered for Gemini, Codex, custom agents or
plain shells.

## Closing a session

| Session state | `confirmCloseShell` | Behaviour |
|---|---|---|
| Exited (nothing running) | either | No sheet. **Deferred commit**: hidden now, deleted when the 6 s toast closes. **Undo** brings it back. |
| Live | on (default) | `AlertSheet` first. After a confirmed close the process is killed at once; Claude sessions with a conversation id get a **Reopen** toast (6 s). |
| Live | off | **Closed immediately** (process killed at once, no sheet, no delayed kill). Claude sessions with a conversation id get a **Reopen** toast (6 s). |

This overrides the plan's original proposal to keep a live agent running behind a 6 s deferred close
(roadmap decision 5). A user who closes a misbehaving agent expects it to stop now.

- Reopen in v1 excludes worktree sessions (Reopen is hidden when `worktreePath` is set).
- Reopen re-creates the session with the same folder, name, agent, flags, engine and run mode, puts it
  back in its group at its original index, and claims it for the current window. It never rewrites
  sticky flag defaults and never persists the resume flags.
- `confirmCloseShell` now means "ask before killing a *running* agent". Exited sessions never ask.
  Settings hint: "Ask before closing a session whose agent is still running. When off, sessions close
  right away; Claude sessions can be reopened from the toast."
- A pending (deferred) close of an exited session is hidden in the current window only. Other windows
  and the phone keep showing it for up to 6 s.

## Destructive actions

| Action | Treatment | Notes |
|---|---|---|
| Close exited session | Deferred commit, Undo, 6 s | See above. |
| Close live session (confirm on) | `AlertSheet`, then Reopen toast | Irreversible kill; Reopen restores the conversation only. |
| Close live session (confirm off) | Immediate close, Reopen toast | Decision 5. |
| Close all sessions in a group / Others | `AlertSheet` | Kills several processes. |
| Restart session | `AlertSheet` | Process kill + mirror reset. |
| Discard git hunk / revert file in diff | Snapshot restore via server `undoId`, Undo, 10 s, no confirm | Server buffer TTL is 30 s, in memory; lost on server restart. Undo fails readably if the agent has since edited the same lines. Undo is scoped to the session's work root. |
| `git-revert-file` route | Delete (dead code, no undo path) | |
| Delete file/folder in Explorer | Snapshot restore via in-app staged trash, Undo, 10 s, no confirm | Falls back to today's "cannot be undone" sheet when the rename crosses volumes (EXDEV). |
| Remove worktree via Finish | Unchanged | Clean + merged, branch kept. |
| Delete worktree from Isolation (dirty → `--force`) | `AlertSheet` | Irreversible; copy names exactly what is lost. |
| Delete group | Snapshot restore, Undo, 6 s | Restores at the original index; members since reassigned or closed are skipped. |
| Delete launcher / template / chain / auto-approval rule | Deferred commit, Undo, 6 s | Re-creating would change ids or lose history; launcher creation is deliberately not exposed over IPC. |
| Remove custom agent | Snapshot restore (`customAgents`, `agentFlags`, `defaultAgent`), Undo, 6 s, no confirm | Restore merges into the current config. |
| Reset all settings | Snapshot restore (`snapshotKeys(config, RESETTABLE_KEYS)`), Undo, 10 s, no confirm | Per-pane Reset uses `snapshotKeys(config, pane.keys)`. |
| Clear scrollback (⌘L) | Unchanged: no confirm, no undo | Standard terminal semantics. |
| Kill orphan daemons | `AlertSheet` | Kills processes. |
| Convert PR to draft | Unchanged (`AlertSheet`) | Undoing would re-request reviewers. |
| Discard New/Clone sheet edits | Unchanged (`AlertSheet`) | |
| Quit & Stop All, stop-all on quit | Unchanged (native dialog) | App lifecycle. |
| Switch pty backend | `AlertSheet` with "Restart now" / "Apply on next launch" | Was a native dialog (V1). |

The quit preferences (`exitSessionsOnQuit`, `confirmExitOnQuit`, `confirmQuitDirectSessions`) are
unchanged. The `argus.revert.skipConfirm` localStorage pref is retired with the revert confirm cards.

The mobile companion keeps its kill confirmation: it has no `ToastProvider`, and kills from a phone are
deliberate.

## Known violations

Each has a planned fix. Owner "004 Ux" refers to the units of plan 004; 003 owns the inline
error-state components. Rows marked **fixed** are done; the native-dialog allowlist in the guard test is
now empty, and the renderer's `dialog:showMessageBox` IPC is gone.

| ID | Location | Violation | Fix | Owner |
|---|---|---|---|---|
| V1 | `RuntimePane.tsx` (backend switch) | Native dialog for an in-app decision | `AlertSheet` with "Restart now" + `altAction` "Apply on next launch" | 004 U9 — **fixed** |
| V2 | `orphanStartupCheck.ts` | Advisory sent as `danger` with "See Settings → Runtime" in the text | `warn` + **Review** action that opens Settings → Runtime | 004 U9 — **fixed** |
| V3 | `useFileBuffer.ts` conflict toast | Duplicates the inline `ConflictBanner` | Delete the toast | 004 U9 — **fixed** |
| V4 | `useFileBuffer.ts` "Saved" toast | Fires on every autosave while the dirty chip already clears | Only for an explicit ⌘S | 004 U9 — **fixed** |
| V5 | `useFileBuffer.ts` save errors | Toast only; `buffer.error` never rendered | Inline error in the editor header with Retry | 003 |
| V6 | `useFileTree.ts` create/rename errors | Toast while the inline name input is still open | Inline error under the edit row | 004 U9 — **fixed** |
| V7 | `useFileTree.ts` folder load failure | Toast | Inline "Couldn't load, Retry" row | 003 |
| V8 | `useFileTree.ts` "Created X" / "Renamed to X" | Toast for a result already visible in the tree | Delete | 004 U9 — **fixed** |
| V9 | `DiffWorkbench.tsx` discard | Failure is silent; `ApiError` thrown unhandled | Inline error in the diff panel header | 004 U4 — **fixed** |
| V10 | `LaunchersPane.tsx`, `TemplatesSection.tsx`, `AutoApprovalPane.tsx` | Inline two-step confirms | Deferred commit + Undo | 004 U6 — **fixed** |
| V11 | `OrphanAgentsSection.tsx` | Inline two-step confirm for an irreversible kill | `AlertSheet` | 004 U9 — **fixed** |
| V12 | `AutoApprovalPane.tsx` | Inline `role=alertdialog` card for a security decision | `AlertSheet` | 004 U9 — **fixed** |
| V13 | `RevertConfirmCard` ×3 + `useSkipRevertConfirm` | Confirm on an undoable action | Remove | 004 U4 — **fixed** |
| V14 | `useSessions.ts` rename error | Toast while the inline rename field exists | Inline under the rename field | 003 |
| V15 | `AgentsPane.tsx` remove, `SettingsOverlay.tsx` Reset all | Confirm on undoable actions | Remove; offer Undo | 004 U6 — **fixed** |

Compliant and unchanged: the quit dialogs, port conflict and update failure dialogs in
`electron/src/main.ts`; the Create/Clone discard sheets; `MergePreviewSheet`; GitHub convert-to-draft;
the Isolation delete sheet; menu/shortcut-origin result toasts in `ArgusApp.tsx`; launch toasts relayed
from main (`LaunchCardStack.tsx`).
