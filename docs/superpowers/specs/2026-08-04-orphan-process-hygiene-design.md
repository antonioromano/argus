# Orphan Process Hygiene — Design

**Date:** 2026-08-04
**Status:** Approved (design), pending implementation plan

## Problem

On 2026-08-04 the machine sat at load average 118 on 11 cores. Cause: 22 orphaned `/bin/zsh`
processes, all reparented to PID 1, each burning ~35% CPU. They were CPU-saturation subshells spawned
by two test-under-load scripts investigating flakiness in
`server/src/services/StateDetector.classify.test.ts`:

```zsh
for i in $(seq 1 $(sysctl -n hw.ncpu)); do (while :; do :; done) & done
BURNERS=$(jobs -p | tr '\n' ' ')
...
kill $BURNERS 2>/dev/null
```

The cleanup line is the *only* exit condition. When the driver shell died before reaching it — a
killed Bash tool call, an interrupted session, a crash — the backgrounded subshells were orphaned and
span forever. Nothing in the system reclaims them; they are not children of any live process, they
hold no resources anyone audits, and they never terminate on their own.

This was not an Argus bug. Argus's own footprint at the time was a single `tmux -L argus-dev` process
at 0.0% CPU. The failure belongs to the ad-hoc load-testing idiom, and it will recur every time that
idiom is used, in any repo.

### Secondary finding: the categories that *look* stale but aren't

While diagnosing, two other process families looked like orphans and were not. Both are recorded here
because the reaper must not kill them:

- **14 `chrome-devtools-mcp` watchdog node processes**, oldest 8 days elapsed. Every one had a live
  `--parent-pid`. They belong to running Claude Code sessions. Age is not evidence of staleness.
- **3 detached `argus-dev` tmux sessions** (`attached=0`), ages 8d / 8d / 1d. Each pane's `pane_pid`
  *is* a live `claude` process with five children. Per Argus's design, tmux sessions deliberately
  outlive the app (Cmd+Q detaches, only "Quit & Stop All" kills). Reaping on `attached=0` alone would
  have destroyed three working agent sessions.

## Solution

Two independent parts. Part 1 removes the recurring cause. Part 2 makes the remaining orphan
categories visible without giving anything the authority to kill them unasked.

### Part 1 — self-terminating burner idiom (prevention)

The fix is to move the deadline *inside* each burner, so `kill $BURNERS` becomes an optimization
rather than the sole exit path. An orphaned burner then expires on its own.

`~/.claude/bin/burn.sh`:

```zsh
# burn <seconds> — saturate all cores, self-terminating even if orphaned.
# Sets BURNERS to the spawned job PIDs so callers may still kill early.
burn() {
  local secs=${1:?usage: burn <seconds>} i
  (( secs >= 1 )) || { print -u2 "burn: seconds must be >= 1"; return 1 }
  (( secs <= 600 )) || { print -u2 "burn: refusing >600s"; return 1 }
  for i in $(seq 1 $(sysctl -n hw.ncpu)); do
    ( end=$(( SECONDS + secs )); while (( SECONDS < end )); do :; done ) &
  done
  BURNERS=$(jobs -p | tr '\n' ' ')
}
```

Design notes:

- **Pure shell, no `timeout`.** Neither `timeout` nor `gtimeout` is installed on this machine
  (verified). A `timeout`-wrapped burner would fail closed on a fresh box; `SECONDS` arithmetic is
  built into zsh and needs nothing.
- **`SECONDS` is per-subshell.** Each subshell gets its own copy at fork, so each computes its own
  absolute deadline. Verified to genuinely load a core: ~2.7M iterations/sec.
- **600s cap.** An upper bound on the worst case if every kill path fails. Long enough for any
  realistic flakiness run, short enough that a forgotten orphan is a nuisance rather than an outage.
- **`BURNERS` is still exported** so existing scripts that call `kill $BURNERS` keep working
  unchanged. The idiom is strictly additive.

### Part 2 — `orphan-reap` (detection, report-only by default)

`~/.claude/bin/orphan-reap`. Prints a table and exits without killing anything. `--yes` kills.

Rules are structural, never age-based:

| # | Category | Rule |
|---|----------|------|
| A | Claude burner husk | `PPID == 1` **and** command contains `.claude/shell-snapshots/` **and** `%CPU >= 20` |
| B | MCP watchdog husk | command has `--parent-pid=N` **and** `kill -0 N` fails |
| C | tmux husk | per argus socket: `session_attached == 0` **and** `pane_pid`'s command is not `claude`/`gemini`/`codex` |
| D | Dead socket file | socket file exists but `tmux -L <sock> list-sessions` reports no server |

Why each rule is safe:

- **A** cannot match an in-flight Bash tool call. A live Claude Code shell has a live parent, so
  `PPID == 1` is false for it. The `%CPU >= 20` clause further excludes an idle orphan that is merely
  waiting on something rather than spinning. Both conditions must hold.
- **B** uses the watchdog's own declared parent rather than elapsed time. This is what makes the 8-day
  watchdogs correctly *ineligible*.
- **C** requires the agent process to be gone, not merely detached. A husk is a pane whose agent has
  exited, leaving a bare shell. Validated against live data: all three detached `argus-dev` sessions
  are correctly spared.
- **D** removes only the socket *file*, and only when no server answers on it.

Behavior:

- Default run: table of category, PID, age, %CPU, and a one-line identification. Exit 0 whether or
  not anything was found. Kills nothing.
- `--yes`: SIGTERM, wait 2s, SIGKILL survivors. Category D unlinks the socket file.
- Sockets are discovered by globbing `/private/tmp/tmux-$UID/argus*`, so `argus`, `argus-dev`, and
  `argus-uitest` are all covered without hardcoding a list.
- Never installed as a hook. Manual invocation only — the reaper has no authority to fire on its own,
  which is what makes a misfire impossible in the categories the user does not control.

### Part 3 — discoverability

One rule in the Argus `CLAUDE.md`, under Commands, pointing at `burn.sh` as the required form for
load testing and naming the bare backgrounded infinite loop as the thing not to write.

Accepted tradeoff: the rule travels with the repo, the scripts live in `~/.claude/bin`, so a fresh
clone on another machine has the instruction but not the tool. Acceptable for a dev-only workflow
aid; the rule text names the path so the gap is self-evident when it bites.

## Verification

Each rule needs a positive and a negative case. The negative cases matter more — a reaper that kills
live work is worse than the original bug.

1. **Burner self-terminates when orphaned.** Spawn via `burn 3` from a shell, kill the parent shell
   immediately, confirm the subshells are gone by t+5s. This is the regression test for the actual
   incident.
2. **`burn` rejects out-of-range input.** `burn 0` and `burn 601` both fail non-zero and spawn nothing.
3. **Rule A positive.** Synthesize an orphaned high-CPU shell matching the snapshot pattern, confirm
   `orphan-reap` lists it, confirm `--yes` kills it.
4. **Rule A negative.** With a normal Bash tool call in flight, confirm it is never listed.
5. **Rule B negative.** Against the current machine state, confirm all live-parent watchdogs are
   reported as ineligible.
6. **Rule C negative.** Against the three live detached `argus-dev` sessions, confirm none is listed.
   This is the highest-consequence test in the suite.
7. **Report-only default.** A run with reapable items present kills nothing unless `--yes` is passed.

## Risks

- **Rule C misclassification** is the sharp edge. If an agent process is momentarily absent from a
  pane — mid-restart, mid-exec — a husk check could fire on a session that is about to come back.
  Mitigated by report-only default plus manual invocation: a human reads the table before anything
  dies. Not mitigated by the rule itself.
- **`%CPU >= 20` in rule A** is a threshold, and thresholds drift. A burner throttled by heavy
  contention could in principle fall below it and be missed. The consequence of a miss is a listed
  orphan going unreaped, not a live process dying, so the failure mode is the safe one.
- **Prevention only covers new scripts.** Any load-test script written before this lands still carries
  the unsafe idiom. Part 2 is what catches those.

## Out of scope

- Automatic or hook-driven reaping. Explicitly declined: it would fire while other Claude Code
  sessions and detached Argus agents are alive.
- A `PreToolUse` hook blocking the unsafe idiom. Considered and declined in favour of prevention by
  construction.
- Patching `chrome-devtools-mcp` or any other third-party process to clean up after itself.
- Any change to Argus application code. Argus was not at fault.
