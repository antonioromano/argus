# Writing guide

How Argus talks. Every label, hint, title, toast and menu item follows these rules; plans that add copy
(hints and tips, error and empty states, undo toasts, the Help menu, the palette) cite this file. Source
plan: `docs/plans/2026-10-29-005-refactor-design-system-hygiene-plan.md`, Unit 10. Where this file and
the plan disagree, this file wins.

Enforced by `client/src/copy.test.ts` (in-app strings) and `electron/src/menuCopy.test.ts` (the menu bar).

## 1. Sentence case in the app

Buttons, labels, section and sheet titles, tooltips, toasts, placeholders: only the first word and proper
nouns are capitalized.

| Do | Don't |
|---|---|
| Stop all sessions when quitting | Exit all sessions on Quit |
| When quitting (section) | On Quit |
| New session | New Session |

Proper nouns keep their capitals: Argus, Claude, Codex, Gemini, GitHub, Mac, macOS, ngrok, tmux, and the
named surfaces **Focus**, **Mosaic**, **Session Inspector**, **Waiting Inbox**, plus the terminal kinds
**Universal**, **Advanced** and **Native**.

## 2. Title Case in menus

The native menu bar **and** context menus (the session menu, the tile ⋯ menu) use Title Case, as the macOS
HIG does. Small words (a, an, and, the, for, in, on, of, to, at, by, or) stay lowercase unless first.
Window titles are Title Case too. Section headers inside a menu (Navigate, Session, Danger) are one word.

| Do | Don't |
|---|---|
| Rename Session… | Rename shell |
| Mark as Done | Mark as done |
| Open in Focus | Expand to focus |

## 3. Buttons are verbs

A button says what it does, with an object when the verb alone is ambiguous: **Delete worktree**, not
**OK** or **Yes**. The confirm button of a destructive question repeats the question's verb: "Close
session?" → **Close session**.

## 4. Ellipsis means "more input follows"

Use `…` (U+2026, never three dots) only when the control opens something that needs more input before
anything happens: a sheet, a picker, a dialog, an inline rename. **Hand off…**, **Settings…**, **Rename
Session…** take one. An action that happens at once (Restart Session, Mark as Done) or after a plain
yes/no confirmation does not. A toggle never does.

## 5. One noun per concept

| Concept | Word | Not |
|---|---|---|
| An agent running in a folder, with its tile, history and status | **session** | shell, tab, instance |
| A git worktree Argus made for a session | **worktree** | isolation, sandbox |
| A named set of sessions in the sidebar | **group** | folder, bucket |
| Claude, Codex, Gemini or a custom command | **agent** | model, bot |
| A saved way to start sessions from a link | **launcher** | shortcut, preset |

**"Shell" means only a real shell process**: the plain-terminal agent, the companion shell docked in
Focus (**Shell** button, **Open Shell** menu item), a login shell. Never call a session a shell.

**Native** is the name of one terminal kind (sessions that run inside Argus and stop when it quits).
Name it with the kind: "sessions using the Native terminal", not "Native sessions" on its own.

## 6. No implementation jargon by default

What is visible without opening Developer or an expanded hint avoids internals: daemon, pty, argusd,
hook, orphan, mirror, janitor, backend. Say what the user gets ("Keeps sessions running after you quit
Argus"), and put the mechanism, if it helps, in the hint line.

| Do | Don't |
|---|---|
| Session host | Process backend |
| Agents without a session | Orphan agents |

## 7. Hints

One sentence that adds something the label does not: when, why, or what changes. Fragments take no final
period; full sentences do. Never restate the label.

| Do | Don't |
|---|---|
| Applies to new and restarted sessions. | Sets the renderer |

## 8. Keys and units

Shortcuts as glyphs: `⌘K`, `⇧⌘N`, never "Cmd+K" in the UI. Units with a space: `5 min`, `24 h`.

## 9. Errors

What happened, then what to do: "Couldn’t resume the conversation. Restart the session to start a new
one." The full format (title, cause, action button) is owned by plan 003's error states; toasts follow
`docs/design/feedback-surfaces.md`.
