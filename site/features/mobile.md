---
title: Mobile view
permalink: /features/mobile/
---

# Mobile view

When an ngrok tunnel is active ([Remote access](../remote/)), open the tunnel URL on your phone for a companion view at `/mobile`.

- Bottom navigation for Sessions, Git Diff and Explorer, plus a button for new sessions.
- Quick-action buttons: arrow keys, Enter, y/n, Ctrl+C, Escape, Tab and options 1 to 5.
- A text input for sending arbitrary commands.
- Touch scrolling with momentum.
- A Chat view for Claude sessions: the session menu (⋮) offers **Open as chat**, which shows the conversation read from Claude's transcript with native scrolling, a composer and tappable prompt answers. Claude sessions open as chat on the phone; **Open terminal** switches back, and the choice is remembered per session. Slash commands that open a picker switch back to the terminal.
- Agents in the Chat: while a Claude session has helper agents running, a strip above the composer lists each one with its type, what it was asked, elapsed time, output tokens and latest step. A finished agent stays for ten seconds with a tick. Tap a row, or **Open** on an Agent step in the conversation, to read that agent's own conversation and tool steps, live while it runs. There is no composer there: you cannot talk to an agent. While only agents are working, the status pill and the session row read **Agents** instead of Idle, with an "N agents" chip; done arrives once they finish. "Claude is writing…" shows under the conversation while a reply is pending and no agent is running. Claude Code records a reply only when it is complete, so the Chat cannot stream it.
- Swipe down to dismiss the diff file sheet.
- Safe-area support for the bottom nav and header.

The phone shows [session identity](../session-identity/) but cannot edit it.
