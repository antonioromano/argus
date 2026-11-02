# Brew Self-Update False Failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Homebrew self-update show "update did not install" only when Argus really did not upgrade, and stop unrelated Homebrew work from failing the update.

**Architecture:** Move the phase-1 and phase-2 shell scripts out of `electron/src/main.ts` into a pure module, `electron/src/brewUpdate.ts`, that builds the script strings. `main.ts` keeps spawning them. Phase 2 runs `brew upgrade` with Homebrew's side work turned off. It decides success by asking brew whether the cask is still outdated, not by brew's exit code. Phase 1 uses the same check to decide "already up to date". Tests run the generated scripts under `/bin/sh` with fake `brew` and `open` executables on `PATH`.

**Tech Stack:** TypeScript (ESM), Electron main process, POSIX sh, `node:test` + `node:assert/strict`.

**Spec:** None. The diagnosis below is the spec.

### Context (diagnosis, 2026-10-27, upgrade 0.29.1 → 0.30.0)

- `update.log`: `argus was successfully upgraded!`, then `==> Reinstalling pkgconf` → `Error: Your Xcode (26.3) at /Applications/Xcode.app is too outdated.` → `install failed (exit 1)`.
- Homebrew's installed-dependents check reinstalled an unrelated formula with broken linkage. That reinstall failed, so `brew upgrade --cask argus` exited 1 even though the cask had been replaced.
- Phase 2 (`main.ts:233-256`) treats any non-zero exit as failure and writes `update.failed`. At the next launch, `surfaceFailedInstall` says "Argus reopened the previous version", which was false: 0.30.0 was running.
- Second bug, found during the read: phase 1 runs `OUTDATED=$(brew outdated --cask argus 2>&1)`. The tap's `postflight` deprecation warning goes to stderr, so `OUTDATED` is never empty and phase 1 can never report "already up to date".
- Verified locally: `brew outdated --cask <c> >/dev/null 2>&1` exits **0** when the cask is installed and current, and **1** when it is outdated or not installed.

## Global Constraints

- Phase-2 `brew upgrade` runs with `HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1`.
- Success predicate (phase 2), and the up-to-date predicate (phase 1): `brew outdated --cask <cask> >/dev/null 2>&1` exits 0. Never parse brew's output text.
- Write `update.failed` (content = brew upgrade's exit code) only when that predicate fails after the upgrade.
- Keep existing phase-1 stdout markers (`@@PHASE …`, `@@UPTODATE`, `@@OK`, `@@FAIL…`) and `[argus-update]` log prefixes byte-identical. The parser in `main.ts` depends on them.
- Relaunch with `open -a Argus` in every phase-2 outcome, as today.
- `npm run verify` green before each commit (repo `CLAUDE.md`).

## Review Focus

1. Brew writes warnings to stderr on every call (the deprecation warning seen here). A success decision must never depend on stderr text. Pinned by Task 1 test "stderr noise does not mark failure" and Task 2 test "up to date despite stderr warning".
2. Brew upgrade exits non-zero AND the cask is still outdated (a real failure, e.g. brew restored the backup). The marker must be written with the exit code. Pinned by Task 1 "real failure writes marker".
3. Brew upgrade exits 0 but the predicate fails (brew claims success, nothing installed). Treat as failure. Pinned by Task 1 "exit 0 but still outdated writes marker".
4. A stale lock file from a crashed phase 2 must still block, matching today's behaviour (no change in scope). Pinned by Task 1 "lock present exits without running brew".
5. The env vars must reach the `upgrade` call, not just appear in the script text. Pinned by Task 1 "upgrade sees env", where fake brew records its env.

---

### Task 1: Phase-2 script builder with outdated-predicate success

**Files:**
- Create: `electron/src/brewUpdate.ts`
- Create: `electron/src/brewUpdate.test.ts`
- Modify: `electron/src/main.ts:226-256` (`startPhase2` builds its script via the new function)

**Interfaces:**
- Produces:
  ```ts
  export const BREW_QUIET_ENV = 'HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1';
  export type Phase2Opts = { cask: string; parentPid: number; logFile: string; lockFile: string; failMarker: string };
  export function buildPhase2Script(o: Phase2Opts): string;
  ```
- `startPhase2(loginShell, logFile, lockFile)` keeps its signature. Its body becomes `buildPhase2Script({ cask: UPDATE_CASK, parentPid: process.pid, logFile, lockFile, failMarker })` plus the existing detached `spawn`.

**Test harness (in `brewUpdate.test.ts`):** a helper `runPhase2(fake: { upgradeExit: number; outdatedExit: number; stderr?: string }, opts?: { lockExists?: boolean })`:
- Creates a `mkdtemp` dir containing `bin/brew` and `bin/open` (chmod 755, `#!/bin/sh`).
- Fake `brew` appends `"$@"` plus `HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK` and `HOMEBREW_NO_AUTO_UPDATE` values to `calls.log`. It echoes `fake.stderr` to stderr. It exits `upgradeExit` for `upgrade` and `outdatedExit` for `outdated`.
- Fake `open` appends `"$@"` to `open.log`.
- Runs `spawnSync('/bin/sh', ['-c', buildPhase2Script({ cask: 'argus', parentPid: <pid of a finished child, e.g. spawnSync('true').pid>, logFile, lockFile, failMarker })], { env: { ...process.env, PATH: \`${bin}:${process.env.PATH}\` } })`.
- Returns `{ calls, opens, marker: string | null, log, lockExistsAfter }`.

- [ ] **Step 1: Write the failing tests**

  ```ts
  test('clean upgrade → relaunch, no marker', …)            // upgradeExit 0, outdatedExit 0 → marker null, opens includes '-a Argus', lockExistsAfter false
  test('upgrade exit 1 but cask current → success', …)      // upgradeExit 1, outdatedExit 0 → marker null; log matches /upgrade exited 1 but argus is current/
  test('real failure writes marker', …)                     // upgradeExit 1, outdatedExit 1 → marker === '1'; opens includes '-a Argus'
  test('exit 0 but still outdated writes marker', …)        // upgradeExit 0, outdatedExit 1 → marker === '0'
  test('stderr noise does not mark failure', …)             // upgradeExit 0, outdatedExit 0, stderr 'Warning: Calling `postflight` is deprecated!' → marker null
  test('upgrade sees env', …)                               // calls line for 'upgrade --cask argus' carries NO_INSTALLED_DEPENDENTS_CHECK=1 and NO_AUTO_UPDATE=1
  test('lock present exits without running brew', …)        // lockExists → calls empty; log matches /phase2 already running/
  ```

- [ ] **Step 2: Run, verify fail**

  Run: `npm run test:electron`
  Expected: FAIL. `brewUpdate.js` is missing, or `buildPhase2Script` is not exported.

- [ ] **Step 3: Implement `buildPhase2Script`**

  Start from the current script in `main.ts:234-251` and change it:
  - Prefix the upgrade line with `${BREW_QUIET_ENV}`, so it reads `${BREW_QUIET_ENV} brew upgrade --cask ${o.cask} >> log 2>&1; BREW_EXIT=$?`.
  - Run the check `brew outdated --cask ${o.cask} >/dev/null 2>&1` (with `HOMEBREW_NO_AUTO_UPDATE=1`).
  - Exit 0 → success: log `install ok, relaunching`. If `BREW_EXIT` ≠ 0, first log `[argus-update] $(date) upgrade exited $BREW_EXIT but ${cask} is current — treating as installed`.
  - Otherwise → failure: log `install failed (exit $BREW_EXIT)` and write `$BREW_EXIT` to the marker.
  - Both branches end with `open -a Argus`. The lock is still removed before the branch.

- [ ] **Step 4: Wire `startPhase2` to the builder.** Delete the inline array in `main.ts`.

- [ ] **Step 5: Run, verify pass**

  Run: `npm run verify`
  Expected: lint, build:all (including check:deps) and every test pass. The 7 new tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add electron/src/brewUpdate.ts electron/src/brewUpdate.test.ts electron/src/main.ts
  git commit -m "fix(update): judge brew install by cask state, not brew exit code"
  ```

### Task 2: Phase-1 up-to-date check via exit code

**Files:**
- Modify: `electron/src/brewUpdate.ts`, `electron/src/brewUpdate.test.ts`
- Modify: `electron/src/main.ts:128-141` (`applyBrewUpdate` uses the builder)

**Interfaces:**
- Consumes: `BREW_QUIET_ENV` (Task 1). Not used here; `brew update` stays explicit.
- Produces: `export function buildPhase1Script(o: { cask: string; tap: string; lockFile: string }): string;`

- [ ] **Step 1: Write the failing tests.** Same fake-bin pattern. Fake `brew` exits 0 for `trust`, `update` and `fetch`, and `outdatedExit` for `outdated`. It always prints the deprecation warning to stderr.

  ```ts
  test('up to date despite stderr warning', …)  // outdatedExit 0 → stdout contains '@@UPTODATE', no 'fetch' in calls
  test('outdated → fetch then @@OK', …)         // outdatedExit 1 → calls include 'fetch --cask argus'; stdout ends with '@@OK'
  test('fetch failure → @@FAIL_EXIT', …)        // outdatedExit 1, fetch exits 2 → stdout contains '@@FAIL_EXIT 2'
  test('lock present → @@FAIL', …)              // stdout contains '@@FAIL Another update is already running.'
  ```

- [ ] **Step 2: Run, verify fail.** Run: `npm run test:electron`. Expected: FAIL, `buildPhase1Script` is not exported.

- [ ] **Step 3: Implement `buildPhase1Script`.** Copy the current array from `main.ts:128-141`. Change only the check: replace the `OUTDATED=$(…)` and `[ -z ]` lines with `if brew outdated --cask ${o.cask} >/dev/null 2>&1; then echo "@@UPTODATE"; exit 0; fi`. Keep every marker string unchanged.

- [ ] **Step 4: Wire `applyBrewUpdate` to the builder** (`buildPhase1Script({ cask: UPDATE_CASK, tap: UPDATE_TAP, lockFile })`).

- [ ] **Step 5: Run, verify pass.** Run: `npm run verify`. Expected: all green.

- [ ] **Step 6: Document it and commit.** Add `docs/solutions/packaging/brew-update-false-failure-2026-10-27.md`, using the same frontmatter shape as its siblings (`module`, `tags`, `problem_type`). Content: the symptom, the root cause (dependents check plus exit-code trust; stderr pollution in phase 1), and the rule "decide on `brew outdated --cask` exit code; never on brew exit or output text".

  ```bash
  git add electron/src/brewUpdate.ts electron/src/brewUpdate.test.ts electron/src/main.ts docs/solutions/packaging/brew-update-false-failure-2026-10-27.md
  git commit -m "fix(update): detect up-to-date by brew outdated exit code"
  ```

## Out of scope

- The tap cask's `postflight` deprecation warning (`homebrew-argus`, `Casks/argus.rb:23`). It's harmless once Tasks 1–2 land. Fix it separately after checking the replacement API in the Homebrew docs.
- Xcode 26.3 / `pkgconf` on the dev machine. That's a local environment problem, not Argus.
