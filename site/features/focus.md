---
title: Focus mode
permalink: /features/focus/
---

# Focus mode

Click a session to expand it so the terminal fills most of the window. Other sessions stay available as a compact strip with status indicators for quick switching.

- Open the [file explorer](../explorer/) or the [diff panel](../diff/) beside the terminal. They are mutually exclusive.
- Press Escape or click the back button to return to the grid. Escape closes things in order: diff fullscreen, diff panel, explorer fullscreen, explorer panel, then focus mode.

## Agents in the Chat

When a Claude session is open as a chat, a strip above the composer lists each running agent: its type, what it was asked, elapsed time, output tokens and latest step. A finished agent stays for ten seconds with a tick. Click a row, or **Open** on an Agent step in the conversation, to read the agent's own conversation and tool steps, live while it runs. Nested agents are listed under their parent. An agent has no composer: you cannot talk to it.

While the session's own turn is over but agents still work, the status pill, the session row and the headers read **Agents** instead of Idle, and an "N agents" chip shows the count. Done arrives once the agents finish.

"Claude is writing…" shows under the conversation while a reply is pending and no agent is running. Claude Code records a reply only when it is complete, so the Chat cannot stream it.
