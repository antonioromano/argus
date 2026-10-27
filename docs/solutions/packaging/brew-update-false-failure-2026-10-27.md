---
title: Self-update reports false failure / never "already up to date" via Homebrew
date: 2026-10-27
category: docs/solutions/packaging/
module: electron (brewUpdate, applyBrewUpdate)
problem_type: logic_error
component: electron/src/brewUpdate.ts, brew outdated, brew upgrade
severity: medium
applies_when:
  - Changing the Homebrew self-update scripts (phase 1 or phase 2)
  - Judging success of any `brew` command from its output or exit status
tags:
  - packaging
  - homebrew
  - self-update
---

# Homebrew self-update false failure

## Symptom

- Up-to-date installs never reported "already up to date"; phase 1 always went on to download.
- Phase 2 could report failure (and show the failure banner) although the cask had upgraded.

## Root cause

- Phase 1 decided "up to date" by `brew outdated` output being empty, but brew prints a deprecation warning on stderr on every call (merged via `2>&1`), so the output was never empty.
- Phase 2 trusted `brew upgrade`'s exit code. Homebrew's installed-dependents check can fail on an unrelated formula and exit 1 even though the cask itself upgraded.

## Rule

Decide on the `brew outdated --cask <cask>` exit code (0 = installed and current, 1 = outdated or missing), never on brew's own exit status or output text. Logic lives in `electron/src/brewUpdate.ts` and is tested against fake `brew`/`open` binaries.
