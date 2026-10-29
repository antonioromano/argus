---
title: Launch links
permalink: /features/launch-links/
---

# Launch links

Other local tools can open a session in Argus with a link:

```
argus://new?agent=claude&folder=~/dev/repo&prompt=...
```

An approval card lists every argument. Nothing runs until you click Start.

Tick Save as launcher to get a one-click `argus://run/<id>` link. Manage launchers in Settings, Launchers.

A saved launcher re-checks its agent command and the contents of the folder's agent config files (`.claude/settings*.json`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.gemini/settings.json`) on every run. Any change sends it back through the approval card.
