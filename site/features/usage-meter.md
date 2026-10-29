---
title: Usage meter
permalink: /features/usage-meter/
---

# Usage meter

Claude and Codex sessions show a usage chip in the session header.

- **Context window:** the percentage used. Argus reads it from Claude's transcript or Codex's `~/.codex/sessions` rollout log.
- **Plan usage:** your plan usage and its reset time. Claude reports it through a status-line wrapper that leaves your own status line unchanged; Codex reports it from its rollout log. Plan usage is per account, so every session of an agent shows the same value.
- Gemini reports no usage, so its sessions show no chip.

Settings, Shell header lets you choose the parts (drag to reorder, click to hide) and set the amber and red thresholds.
