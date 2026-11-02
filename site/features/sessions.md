---
title: Sessions
permalink: /features/sessions/
---

# Sessions

Create a session by picking a project folder (system picker or folder tree), an optional name and the agent to run. Built-in agents are Claude Code, Gemini CLI and OpenAI Codex. Add any other CLI under Settings.

- **Status badges:** `waiting` (prompt visible), `running` (agent working), `idle` (quiet, no prompt) or `exited`.
- **Clone:** duplicate a session in the same folder with a different agent or flags.
- **Delete:** closes the session after a confirmation.
- **Collapse:** minimize a session to a chip at the top. It stays connected and keeps showing live status.
- **Agent flags:** set per-agent CLI flags (for example `--model`) in Settings, and toggle them per session at creation.
- **Git dirty indicator:** a warning icon next to the name when the folder has uncommitted changes.
- **Resume conversation:** an exited Claude session offers Resume conversation, which relaunches with `claude --resume <id>`. It also works after Argus restarts.
- **Reconnect replay:** reloading or reconnecting restores the screen and scrollback.

Sessions are grouped by working folder. Drag groups and sessions to reorder them; the order is saved.

See also: [Session identity](../session-identity/), [Mosaic](../mosaic/).
