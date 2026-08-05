# Orphan Process Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop ad-hoc load-testing scripts from leaving immortal CPU-burning orphans behind, and give a safe report-only way to find the orphan classes that cannot fix themselves.

**Architecture:** Two independent shell deliverables in `~/.claude/bin` plus one documentation rule in the Argus repo. `burn.sh` moves the burner deadline inside each subshell so an orphan expires unaided. `orphan-reap` classifies orphans by structural rules (parentage, declared parent liveness, childlessness) rather than by age, prints a table, and kills nothing unless `--yes` is passed. Tests live in the repo and target the scripts through an overridable path so they are reviewable and version-controlled even though the scripts are not.

**Tech Stack:** zsh 5.9, BSD `ps`, `pgrep`, tmux 3.x (`/opt/homebrew/bin/tmux`). No `bats` on this machine — the test harness is a self-contained zsh script with assertion helpers. No new dependencies.

## Amendments (2026-08-05) — these OVERRIDE any task snippet they contradict

Four corrections from the Task 4 review, all ruled on by the human partner. The task sections below
predate them.

1. **Rule D is report-only, permanently.** `orphan-reap` must NEVER unlink a socket file, even with
   `--yes`. Remove the `to_unlink` / `rm -f` path entirely.
   *Why:* rule D inferred "server is gone" from `list-sessions` exiting non-zero, which is also what
   a protocol-version mismatch looks like after `brew upgrade tmux` while a server runs. A tmux
   server cannot recreate its socket file, so unlinking a live server's socket leaves it running but
   **permanently unattachable** — the next attach silently starts a fresh empty server, orphaning the
   agents inside. On this machine that would have been 3 live `claude` sessions, one 8 days old.
   Auto-deleting a 0-byte file was never worth that.
2. **Rule D must still fail closed when classifying.** Emit D only when tmux's stderr actually
   indicates absence (`no server running`, `No such file or directory`, `onnection refused`).
   Anything else is reported as *inconclusive*, not dead. This matters more, not less, under
   report-only: a human now does the deleting, so a wrong D line could send them at a live socket.
3. **Use `-S "$sock"` (full socket path), never `-L "${sock:t}"`, in `find_tmux_husks`.** Verified:
   `-L <name>` resolves the name under tmux's own tmpdir, ignoring where the socket was actually
   found — `tmux -L probe-sock list-sessions` reports `error connecting to
   /private/tmp/tmux-501/probe-sock` for a socket living elsewhere, while `-S <full path>` finds it.
   With `-L`, Task 5's `ORPHAN_REAP_TMUX_DIR` seam would glob fixture sockets in the scratch dir and
   then probe the real dir, classifying every fixture as dead — rule C would be silently dead in the
   scoped suite while the D-side tests still passed.
4. **`local` at zsh script top level is VALID.** Earlier revisions of this plan asserted it was
   invalid and every task dispatch repeated it. That is a *bash* rule: `bash -c 'local y=2'` fails
   with "can only be used in a function"; `zsh -c 'local y=2'` succeeds. No code change is required
   anywhere, and the Task 4 review finding that rested on it is not a defect.

## Global Constraints

- Target shell is **zsh 5.9** on darwin (arm64). `emulate -L zsh` at the top of every script.
- **No `timeout` / `gtimeout`** — neither is installed. Deadlines must use zsh `SECONDS` arithmetic.
- Burner duration cap is **600 seconds**, floor **1 second**. Out-of-range input exits non-zero and spawns nothing.
- Rule A CPU threshold is **20** (`%CPU >= 20`), overridable via `ORPHAN_REAP_CPU_MIN`.
- `orphan-reap` **kills nothing** without `--yes`. Default run always exits 0.
- `orphan-reap` is **never** wired to a hook. Manual invocation only.
- tmux socket discovery globs `/private/tmp/tmux-$(id -u)/argus*` — never a hardcoded socket list.
- Rule C must not reference any agent-binary whitelist. Argus's `AgentRegistry` supports custom `agentType` values; the test is "bare shell with no children".
- Scripts install to `$HOME/.claude/bin` (the directory does not exist yet and must be created). Tests locate them via `ORPHAN_HYGIENE_BIN`, defaulting to `$HOME/.claude/bin`.
- All work happens in the worktree `~/development/projects/argus-orphan-hygiene` on branch `chore/orphan-process-hygiene`. **Never** `git checkout` in `~/development/projects/argus` — concurrent sessions share that working tree.

---

## File Structure

| Path | Responsibility |
|---|---|
| `$HOME/.claude/bin/burn.sh` | Sourceable `burn()` function. Self-terminating CPU saturation. Not executable, not a CLI. |
| `$HOME/.claude/bin/orphan-reap` | Executable CLI. Classifies and reports orphans; kills with `--yes`. |
| `scripts/orphan-hygiene/assert.zsh` | Test assertion helpers (`assert_eq`, `assert_contains`, `assert_not_contains`, `assert_exit`, `skip`, `summary`). Shared by both test files. |
| `scripts/orphan-hygiene/test-burn.zsh` | Tests for `burn.sh` (Tasks 1). |
| `scripts/orphan-hygiene/test-reap.zsh` | Tests for `orphan-reap` (Tasks 2–5). |
| `scripts/orphan-hygiene/fixtures.zsh` | Spawns/destroys synthetic orphans and fake tmux sessions used by `test-reap.zsh`. |
| `CLAUDE.md` | One rule under Commands naming `burn.sh` as the required load-test form. |

Splitting tests into `test-burn` / `test-reap` keeps each runnable alone; `fixtures.zsh` is separate because spawning orphans and fake tmux servers is the riskiest code in the suite and deserves to be read on its own.

---

### Task 1: Self-terminating burner + test harness

**Files:**
- Create: `$HOME/.claude/bin/burn.sh`
- Create: `scripts/orphan-hygiene/assert.zsh`
- Create: `scripts/orphan-hygiene/test-burn.zsh`

**Interfaces:**
- Consumes: nothing.
- Produces: `burn <seconds>` shell function, sets global `BURNERS` to a space-separated PID list. `assert.zsh` exports `assert_eq <actual> <expected> <label>`, `assert_contains <haystack> <needle> <label>`, `assert_not_contains <haystack> <needle> <label>`, `assert_exit <expected_code> <label> <cmd...>`, `skip <label> <reason>`, `summary` (exits 1 if any assertion failed).

- [ ] **Step 1: Write the assertion helpers**

Create `scripts/orphan-hygiene/assert.zsh`:

```zsh
# Shared assertion helpers for the orphan-hygiene test scripts.
# Source this, run assertions, call `summary` last.
emulate -L zsh

typeset -g ASSERT_PASS=0 ASSERT_FAIL=0 ASSERT_SKIP=0

assert_eq() {
  local actual=$1 expected=$2 label=$3
  if [[ $actual == $expected ]]; then
    (( ASSERT_PASS++ )); print "  ok   $label"
  else
    (( ASSERT_FAIL++ )); print "  FAIL $label"; print "       expected: $expected"; print "       actual:   $actual"
  fi
}

assert_contains() {
  local haystack=$1 needle=$2 label=$3
  if [[ $haystack == *$needle* ]]; then
    (( ASSERT_PASS++ )); print "  ok   $label"
  else
    (( ASSERT_FAIL++ )); print "  FAIL $label"; print "       missing: $needle"; print "       in:      $haystack"
  fi
}

assert_not_contains() {
  local haystack=$1 needle=$2 label=$3
  if [[ $haystack != *$needle* ]]; then
    (( ASSERT_PASS++ )); print "  ok   $label"
  else
    (( ASSERT_FAIL++ )); print "  FAIL $label"; print "       must not contain: $needle"; print "       in:               $haystack"
  fi
}

assert_exit() {
  local expected=$1 label=$2; shift 2
  "$@" >/dev/null 2>&1
  assert_eq $? $expected "$label"
}

skip() {
  (( ASSERT_SKIP++ )); print "  skip $1 ($2)"
}

summary() {
  print ""
  print "pass=$ASSERT_PASS fail=$ASSERT_FAIL skip=$ASSERT_SKIP"
  (( ASSERT_FAIL == 0 ))
}
```

- [ ] **Step 2: Write the failing test for burn.sh**

Create `scripts/orphan-hygiene/test-burn.zsh`:

```zsh
#!/bin/zsh
# Tests for burn.sh — run: zsh scripts/orphan-hygiene/test-burn.zsh
#
# Deliberately NO `setopt err_return`: several assertions run commands that are
# expected to fail (assert_exit 1 ...), and err_return would abort the suite on
# the first intentional failure.
emulate -L zsh

SCRIPT_DIR=${0:A:h}
source $SCRIPT_DIR/assert.zsh

BIN=${ORPHAN_HYGIENE_BIN:-$HOME/.claude/bin}
source $BIN/burn.sh

print "test-burn: range validation"
assert_exit 1 "burn 0 is rejected"   burn 0
assert_exit 1 "burn 601 is rejected" burn 601
assert_exit 1 "burn with no arg is rejected" burn

print "test-burn: rejected input spawns nothing"
BURNERS=""
burn 0 >/dev/null 2>&1
assert_eq "${BURNERS:-empty}" "empty" "no BURNERS set after rejected call"

print "test-burn: burners run and are killable early"
burn 30
typeset -a pids=(${=BURNERS})
assert_eq $(( ${#pids} > 0 ? 1 : 0 )) 1 "burn 30 spawned at least one burner"
# `alive` is a plain global — `local` is only valid inside a function in zsh and
# would abort the script at top level.
alive=0
for p in $pids; do kill -0 $p 2>/dev/null && (( alive++ )); done
assert_eq $(( alive == ${#pids} ? 1 : 0 )) 1 "all spawned burners are alive"
kill $pids 2>/dev/null
sleep 1
alive=0
for p in $pids; do kill -0 $p 2>/dev/null && (( alive++ )); done
assert_eq $alive 0 "kill \$BURNERS still terminates them early"

print "test-burn: orphaned burner self-terminates (the incident regression)"
# The subshell writes its burner PIDs, then exits. Its exit reparents the still-
# running burners to PID 1 — exactly the 2026-08-04 orphan condition, where the
# driver died before reaching `kill $BURNERS`.
PIDFILE=$(mktemp)
( source $BIN/burn.sh; burn 3; print -r -- $BURNERS > $PIDFILE ) &
tries=0
while [[ ! -s $PIDFILE ]] && (( tries++ < 50 )); do sleep 0.1; done
typeset -a orphans=(${=$(< $PIDFILE)})
rm -f $PIDFILE
if (( ${#orphans} == 0 )); then
  skip "orphaned burner self-terminates" "could not capture orphan pids"
else
  sleep 6   # deadline was 3s; 6s covers scheduling slop plus the capture wait
  alive=0
  for p in $orphans; do kill -0 $p 2>/dev/null && (( alive++ )); done
  assert_eq $alive 0 "orphaned burners expired on their own deadline"
  # Belt and braces: never leave test burners behind even if the assertion failed.
  kill -9 $orphans 2>/dev/null
fi

summary
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `zsh scripts/orphan-hygiene/test-burn.zsh`
Expected: FAIL — `source: no such file or directory: /Users/<you>/.claude/bin/burn.sh`

- [ ] **Step 4: Write burn.sh**

```bash
mkdir -p "$HOME/.claude/bin"
```

Create `$HOME/.claude/bin/burn.sh`:

```zsh
# burn <seconds> — saturate all cores with self-terminating busy loops.
#
# Why the deadline is INSIDE each subshell: on 2026-08-04, 22 burners spawned by
# `(while :; do :; done) &` were orphaned when their driver shell died before its
# `kill $BURNERS` line ran. They spun forever at load average 118. Each subshell
# here owns an absolute deadline, so `kill $BURNERS` is an optimization, not the
# only exit path.
#
# Usage:
#   source ~/.claude/bin/burn.sh
#   burn 60
#   ...run the thing you want to observe under load...
#   kill $BURNERS 2>/dev/null   # optional, early release
burn() {
  emulate -L zsh
  local secs=${1:-} i
  if [[ $secs != <-> ]]; then
    print -u2 "burn: usage: burn <seconds>  (1-600)"
    return 1
  fi
  if (( secs < 1 || secs > 600 )); then
    print -u2 "burn: seconds must be between 1 and 600 (got $secs)"
    return 1
  fi
  typeset -ga BURNERS=()
  for i in $(seq 1 $(sysctl -n hw.ncpu)); do
    ( end=$(( SECONDS + secs )); while (( SECONDS < end )); do :; done ) &
    BURNERS+=($!)
  done
}
```

`BURNERS` must be an **array**, populated from `$!`. The incident script's
`BURNERS=$(jobs -p | tr '\n' ' ')` was broken two independent ways, and each was verified:

1. **Empty.** Command substitution runs in a subshell with no job table, so `X=$(jobs -p)`
   yields `[]` while a direct `jobs -p` lists the jobs.
2. **Unsplittable even when populated.** zsh does not word-split unquoted scalars
   (`SH_WORD_SPLIT` off, including under `emulate -L zsh`). With `BURNERS="78214 78215 "`,
   `kill $BURNERS` gives `zsh:kill:6: illegal pid: 78214 78215` and both processes survive;
   only `kill ${=BURNERS}` works.

So the incident's `kill $BURNERS` could never have killed anything even had the driver shell
survived to run it — orphaning was its second failure, not its only one. An array fixes both:
`kill $BURNERS` expands to multiple words naturally, so no caller has to remember `${=...}`.
The test suite must exercise `kill $BURNERS` **literally** — an assertion that pre-splits
would not have caught defect 2.

- [ ] **Step 5: Run the test to verify it passes**

Run: `zsh scripts/orphan-hygiene/test-burn.zsh`
Expected: PASS, `fail=0`. The orphan test takes ~7s.

- [ ] **Step 6: Confirm no burners leaked from the test run**

Run: `ps -eo pid,ppid,pcpu,comm | awk '$2==1 && $4=="/bin/zsh" && $3>=20'`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add scripts/orphan-hygiene/assert.zsh scripts/orphan-hygiene/test-burn.zsh
git commit -m "feat(tooling): self-terminating burner idiom for load tests

Deadline lives inside each burner subshell, so an orphaned burner expires
on its own instead of spinning forever when the driver shell dies before
its kill line runs. Regression test double-forks to reproduce the exact
orphan condition from the 2026-08-04 load-118 incident.

burn.sh itself lives in ~/.claude/bin (outside the repo); this commit adds
the committed test suite that targets it."
```

---

### Task 2: `orphan-reap` skeleton and Rule A (burner husks)

**Files:**
- Create: `$HOME/.claude/bin/orphan-reap`
- Create: `scripts/orphan-hygiene/fixtures.zsh`
- Create: `scripts/orphan-hygiene/test-reap.zsh`

**Interfaces:**
- Consumes: `assert.zsh` from Task 1.
- Produces: executable `orphan-reap [--yes|--help]`. Emits one `|`-delimited record per finding on stdout in the form `CATEGORY|PID|AGE|CPU|DESCRIPTION`, preceded by a header line. `fixtures.zsh` exports `fixture_spawn_orphan_burner` (prints the orphan's PID), `fixture_spawn_parented_burner` (prints `PARENT_PID CHILD_PID`), and `fixture_cleanup` (kills everything it spawned).

- [ ] **Step 1: Write the fixtures**

Create `scripts/orphan-hygiene/fixtures.zsh`:

```zsh
# Synthetic orphans for test-reap.zsh. Every spawner records its PIDs in
# FIXTURE_PIDS so fixture_cleanup can guarantee nothing outlives the test run.
emulate -L zsh

typeset -ga FIXTURE_PIDS=()

# A high-CPU shell with PPID 1 whose command line contains the shell-snapshot
# marker — i.e. an exact structural match for the 2026-08-04 orphans.
# Self-limits to 60s so a crashed test run cannot leave a spinner behind.
fixture_spawn_orphan_burner() {
  local marker='/Users/x/.claude/shell-snapshots/snapshot-zsh-fixture.sh'
  local pidfile=$(mktemp)
  # Double-fork: the intermediate subshell exits at once, reparenting the burner to PID 1.
  ( /bin/zsh -c "# $marker
                 print \$\$ > $pidfile
                 end=\$((SECONDS+60)); while ((SECONDS<end)); do :; done" & ) 2>/dev/null
  local tries=0
  while [[ ! -s $pidfile ]] && (( tries++ < 50 )); do sleep 0.1; done
  local pid=$(< $pidfile); rm -f $pidfile
  [[ -n $pid ]] && FIXTURE_PIDS+=($pid)
  print -r -- $pid
}

# Same shape, but with a LIVE parent — Rule A must never list this one.
fixture_spawn_parented_burner() {
  local marker='/Users/x/.claude/shell-snapshots/snapshot-zsh-fixture.sh'
  local pidfile=$(mktemp)
  /bin/zsh -c "# $marker
               /bin/zsh -c '# $marker
                            print \$\$ > $pidfile
                            end=\$((SECONDS+60)); while ((SECONDS<end)); do :; done' &
               sleep 60" &
  local parent=$!
  local tries=0
  while [[ ! -s $pidfile ]] && (( tries++ < 50 )); do sleep 0.1; done
  local child=$(< $pidfile); rm -f $pidfile
  FIXTURE_PIDS+=($parent $child)
  print -r -- "$parent $child"
}

fixture_cleanup() {
  (( ${#FIXTURE_PIDS} )) && kill -9 ${FIXTURE_PIDS} 2>/dev/null
  FIXTURE_PIDS=()
  return 0
}
```

- [ ] **Step 2: Write the failing Rule A tests**

Create `scripts/orphan-hygiene/test-reap.zsh`:

```zsh
#!/bin/zsh
# Tests for orphan-reap — run: zsh scripts/orphan-hygiene/test-reap.zsh
emulate -L zsh

SCRIPT_DIR=${0:A:h}
source $SCRIPT_DIR/assert.zsh
source $SCRIPT_DIR/fixtures.zsh

BIN=${ORPHAN_HYGIENE_BIN:-$HOME/.claude/bin}
REAP=$BIN/orphan-reap

trap 'fixture_cleanup' EXIT INT TERM

print "test-reap: rule A — burner husks"
orphan_pid=$(fixture_spawn_orphan_burner)
if [[ -z $orphan_pid ]]; then
  skip "rule A positive" "fixture failed to spawn"
else
  sleep 1   # let %CPU accumulate above the threshold
  out=$($REAP)
  assert_contains "$out" "A|$orphan_pid|" "rule A lists the orphaned burner"
fi

print "test-reap: rule A — a burner with a live parent is never listed"
read -r parented_parent parented_child <<< "$(fixture_spawn_parented_burner)"
if [[ -z $parented_child ]]; then
  skip "rule A negative" "fixture failed to spawn"
else
  sleep 1
  out=$($REAP)
  assert_not_contains "$out" "A|$parented_child|" "parented burner is not listed"
fi

print "test-reap: default run kills nothing"
if [[ -n $orphan_pid ]]; then
  kill -0 $orphan_pid 2>/dev/null
  assert_eq $? 0 "orphan survives a default (report-only) run"
fi

fixture_cleanup
summary
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `zsh scripts/orphan-hygiene/test-reap.zsh`
Expected: FAIL — `$REAP` does not exist, so `out` is empty and both `assert_contains` calls fail.

- [ ] **Step 4: Write orphan-reap with Rule A only**

Create `$HOME/.claude/bin/orphan-reap` and `chmod +x` it:

```zsh
#!/bin/zsh
# orphan-reap — find dev-tooling orphans. Reports by default; kills only with --yes.
#
# Rules are structural, never age-based. Age is not evidence of staleness: on
# 2026-08-04 the oldest processes on the machine (8-day MCP watchdogs, 8-day
# detached tmux agents) were all healthy, while the genuinely dead ones were
# three minutes old.
emulate -L zsh
setopt pipe_fail

typeset -g DO_KILL=0
typeset -g CPU_MIN=${ORPHAN_REAP_CPU_MIN:-20}

usage() {
  cat <<'EOF'
usage: orphan-reap [--yes]

Reports orphaned dev processes. Kills nothing unless --yes is given.

  (no flags)  print a table of findings, exit 0
  --yes       SIGTERM findings, wait 2s, SIGKILL survivors
  -h|--help   this text

Categories:
  A  claude burner husk   PPID 1, command matches .claude/shell-snapshots/, %CPU >= $ORPHAN_REAP_CPU_MIN (default 20)

Load testing: source ~/.claude/bin/burn.sh and use `burn <seconds>`. Never write
a bare `(while :; do :; done) &` — an orphan of that form never exits.
EOF
}

case ${1:-} in
  --yes)     DO_KILL=1 ;;
  -h|--help) usage; exit 0 ;;
  "")        ;;
  *)         print -u2 "orphan-reap: unknown argument: $1"; usage >&2; exit 2 ;;
esac

# Emits: A|<pid>|<age>|<cpu>|<description>
find_burner_husks() {
  ps -eo pid=,ppid=,pcpu=,etime=,command= | while read -r pid ppid pcpu etime command; do
    [[ $ppid == 1 ]] || continue
    [[ $command == *.claude/shell-snapshots/* ]] || continue
    (( ${pcpu%%.*} >= CPU_MIN )) || continue
    print -r -- "A|$pid|$etime|$pcpu|claude burner husk (orphaned load-test subshell)"
  done
}

typeset -a findings
findings=(${(f)"$(find_burner_husks)"})
findings=(${findings:#})   # drop empty entries

if (( ! ${#findings} )); then
  print "orphan-reap: nothing to reap"
  exit 0
fi

print "CATEGORY|PID|AGE|CPU|WHAT"
print -l -- $findings

if (( ! DO_KILL )); then
  print ""
  print "orphan-reap: report only — nothing was killed. Re-run with --yes to kill."
  exit 0
fi

typeset -a to_kill
for f in $findings; do
  local pid=${${(s:|:)f}[2]}
  [[ $pid == <-> ]] && to_kill+=($pid)
done

if (( ${#to_kill} )); then
  print ""
  print "orphan-reap: SIGTERM ${to_kill}"
  kill ${to_kill} 2>/dev/null
  sleep 2
  typeset -a survivors=()
  for pid in $to_kill; do kill -0 $pid 2>/dev/null && survivors+=($pid); done
  if (( ${#survivors} )); then
    print "orphan-reap: SIGKILL ${survivors}"
    kill -9 ${survivors} 2>/dev/null
  fi
  print "orphan-reap: done"
fi
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `zsh scripts/orphan-hygiene/test-reap.zsh`
Expected: PASS, `fail=0`.

- [ ] **Step 6: Confirm no fixture processes leaked**

Run: `ps -eo pid,command | grep 'snapshot-zsh-fixture' | grep -v grep`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add scripts/orphan-hygiene/fixtures.zsh scripts/orphan-hygiene/test-reap.zsh
git commit -m "feat(tooling): orphan-reap rule A for orphaned burner husks

Rule A requires PPID 1 AND a .claude/shell-snapshots/ command line AND
%CPU >= 20, so an in-flight Bash tool call (which always has a live parent)
can never match. Report-only by default.

Fixtures double-fork to synthesize a real PID-1 orphan, and spawn an
identically-shaped burner with a live parent as the negative case."
```

---

### Task 3: Rule B (MCP watchdogs with dead parents)

**Files:**
- Modify: `$HOME/.claude/bin/orphan-reap`
- Modify: `scripts/orphan-hygiene/fixtures.zsh`
- Modify: `scripts/orphan-hygiene/test-reap.zsh`

**Interfaces:**
- Consumes: `find_burner_husks` and the `CATEGORY|PID|AGE|CPU|DESCRIPTION` record format from Task 2.
- Produces: `find_watchdog_husks`, emitting `B|<pid>|<age>|-|<description>`. Adds two fixtures: `fixture_spawn_watchdog <parent_pid>` (prints the fake watchdog's PID) and `fixture_dead_pid` (prints a PID guaranteed not to be running).

- [ ] **Step 1: Add the watchdog fixture**

Append to `scripts/orphan-hygiene/fixtures.zsh`:

```zsh
# A process whose command line carries --parent-pid=<pid>, mimicking
# chrome-devtools-mcp's watchdog. Pass a dead PID to make it a husk, a live
# PID to make it healthy.
fixture_spawn_watchdog() {
  local parent_pid=$1
  local pidfile=$(mktemp)
  /bin/zsh -c "# watchdog/main.js --parent-pid=$parent_pid --app-version=0.0.0
               print \$\$ > $pidfile
               sleep 60" &
  FIXTURE_PIDS+=($!)
  local tries=0
  while [[ ! -s $pidfile ]] && (( tries++ < 50 )); do sleep 0.1; done
  local pid=$(< $pidfile); rm -f $pidfile
  [[ -n $pid ]] && FIXTURE_PIDS+=($pid)
  print -r -- $pid
}

# A PID that is guaranteed not to be running: spawn `true` and reap it.
fixture_dead_pid() {
  /bin/zsh -c 'exit 0' &
  local p=$!
  wait $p 2>/dev/null
  print -r -- $p
}
```

- [ ] **Step 2: Write the failing Rule B tests**

Insert into `scripts/orphan-hygiene/test-reap.zsh`, immediately before the final `fixture_cleanup`:

```zsh
print "test-reap: rule B — watchdog with a dead parent is listed"
dead=$(fixture_dead_pid)
wd_husk=$(fixture_spawn_watchdog $dead)
if [[ -z $wd_husk ]]; then
  skip "rule B positive" "fixture failed to spawn"
else
  out=$($REAP)
  assert_contains "$out" "B|$wd_husk|" "watchdog with dead parent is listed"
fi

print "test-reap: rule B — watchdog with a live parent is never listed"
wd_ok=$(fixture_spawn_watchdog $$)
if [[ -z $wd_ok ]]; then
  skip "rule B negative" "fixture failed to spawn"
else
  out=$($REAP)
  assert_not_contains "$out" "B|$wd_ok|" "watchdog with live parent is not listed"
fi

print "test-reap: rule B — real machine watchdogs with live parents are spared"
out=$($REAP)
# NOTE: process substitution, not a pipe. A `cmd | while read` loop runs in a
# subshell, so assert_* would increment ASSERT_PASS/ASSERT_FAIL in a child and
# the counts — including failures — would be discarded. `< <(...)` keeps the
# loop body in this shell.
while read -r rpid rcmd; do
  rparent=${${rcmd##*--parent-pid=}%%[[:space:]]*}
  [[ $rparent == <-> ]] || continue
  if kill -0 $rparent 2>/dev/null; then
    assert_not_contains "$out" "B|$rpid|" "live-parent watchdog $rpid spared"
  fi
done < <(ps -eo pid=,command= | grep -- '--parent-pid=' | grep -v grep)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `zsh scripts/orphan-hygiene/test-reap.zsh`
Expected: FAIL on "watchdog with dead parent is listed" — no `B|` records exist yet.

- [ ] **Step 4: Implement Rule B**

In `$HOME/.claude/bin/orphan-reap`, add after `find_burner_husks`:

```zsh
# Emits: B|<pid>|<age>|-|<description>
# Uses the watchdog's own declared parent rather than elapsed time. This is what
# makes the 8-day-old but perfectly healthy watchdogs correctly ineligible.
find_watchdog_husks() {
  ps -eo pid=,etime=,command= | while read -r pid etime command; do
    [[ $command == *--parent-pid=* ]] || continue
    local parent=${${command##*--parent-pid=}%%[[:space:]]*}
    [[ $parent == <-> ]] || continue
    kill -0 $parent 2>/dev/null && continue
    print -r -- "B|$pid|$etime|-|mcp watchdog husk (declared parent $parent is gone)"
  done
}
```

Then change the findings assembly to include it:

```zsh
findings=(${(f)"$(find_burner_husks)"} ${(f)"$(find_watchdog_husks)"})
findings=(${findings:#})
```

And add to `usage()`, under the Categories block:

```
  B  mcp watchdog husk   command has --parent-pid=N where N is no longer running
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `zsh scripts/orphan-hygiene/test-reap.zsh`
Expected: PASS, `fail=0`. The "real machine watchdogs spared" block asserts once per live watchdog — on this machine that is ~14 assertions.

- [ ] **Step 6: Commit**

```bash
git add scripts/orphan-hygiene/fixtures.zsh scripts/orphan-hygiene/test-reap.zsh
git commit -m "feat(tooling): orphan-reap rule B for MCP watchdog husks

Staleness is decided by the watchdog's own --parent-pid liveness, not by
age. Guards against the mistake this rule was written to avoid: the oldest
watchdogs on the machine (8 days) all had live parents and belonged to
running sessions.

Test asserts every real live-parent watchdog currently running is spared."
```

---

### Task 4: Rules C and D (tmux husks and dead socket files)

**Files:**
- Modify: `$HOME/.claude/bin/orphan-reap`
- Modify: `scripts/orphan-hygiene/fixtures.zsh`
- Modify: `scripts/orphan-hygiene/test-reap.zsh`

**Interfaces:**
- Consumes: the record format and `findings` assembly from Tasks 2–3.
- Produces: `find_tmux_husks`, emitting `C|<pane_pid>|<age>|-|<description>` and `D|-|-|-|<socket path>`. Adds five fixtures: `fixture_tmux_socket` (sets and prints a scratch socket name), `fixture_tmux_husk_session` (prints the session name), `fixture_tmux_live_session` (prints the session name), `fixture_tmux_pane_pid <session>` (prints that session's first pane PID), and `fixture_tmux_teardown`. Also sets the global `TMUX_BIN`, which `test-reap.zsh` uses directly.

> **Hazards established AFTER this plan was written — they override the code below where they
> conflict.** Tasks 1-3 each hit a shell-semantics defect in this plan's fixture code. The snippets
> below were written before those were known, so treat them as intent, not as text to transcribe:
>
> 1. **`nohup` every backgrounded fixture process** (`>/dev/null 2>&1` to avoid `nohup.out`). zsh
>    SIGHUPs a shell's own background jobs when that shell exits, and fixtures are called as
>    `$(fixture_...)`, whose subshell exits immediately. *Probably not needed for the tmux fixtures
>    below — `tmux new-session -d` daemonizes the server, so the pane processes are tmux's children,
>    not the calling subshell's — but verify rather than assume.*
> 2. **Record PIDs via the existing `_fixture_record` / `FIXTURE_PID_LOG` helper**, never
>    `FIXTURE_PIDS+=($pid)` inside a `$( )` function — a subshell's array mutation never reaches the
>    parent, which silently emptied `fixture_cleanup`'s kill list and leaked two real burners.
> 3. **A `zsh -c` script's final command gets exec-elided**, replacing the shell's process image and
>    wiping any marker text from `ps`. Add a trailing `:` to any fixture whose *command line* must
>    remain inspectable. Irrelevant where the pane is meant to be a bare shell.
> 4. `fixture_tmux_socket` must be called plainly (`fixture_tmux_socket >/dev/null`), not via
>    `$( )` — it sets the global `FIXTURE_TMUX_SOCK`, which a subshell would discard.

- [ ] **Step 1: Add the tmux fixtures**

Append to `scripts/orphan-hygiene/fixtures.zsh`:

```zsh
# Scratch tmux server on its own argus-prefixed socket so the reaper's
# /private/tmp/tmux-$(id -u)/argus* glob picks it up. Never touches the real
# argus / argus-dev / argus-uitest sockets.
typeset -g FIXTURE_TMUX_SOCK=""
TMUX_BIN=${TMUX_BIN:-$(command -v tmux || print /opt/homebrew/bin/tmux)}

fixture_tmux_socket() {
  FIXTURE_TMUX_SOCK="argus-fixture-$$"
  print -r -- $FIXTURE_TMUX_SOCK
}

# A husk: detached session whose pane is a bare childless shell.
fixture_tmux_husk_session() {
  local sess="husk-$$"
  $TMUX_BIN -L $FIXTURE_TMUX_SOCK new-session -d -s $sess '/bin/zsh -f' 2>/dev/null
  sleep 1
  print -r -- $sess
}

# A live session: detached, but the pane runs a non-shell command with a child.
# `cat` stands in for a custom AgentRegistry agentType — deliberately NOT one of
# claude/gemini/codex, because rule C must not depend on an agent whitelist.
fixture_tmux_live_session() {
  local sess="live-$$"
  $TMUX_BIN -L $FIXTURE_TMUX_SOCK new-session -d -s $sess '/bin/cat' 2>/dev/null
  sleep 1
  print -r -- $sess
}

fixture_tmux_pane_pid() {
  $TMUX_BIN -L $FIXTURE_TMUX_SOCK list-panes -t $1 -F '#{pane_pid}' 2>/dev/null | head -1
}

fixture_tmux_teardown() {
  [[ -n $FIXTURE_TMUX_SOCK ]] && $TMUX_BIN -L $FIXTURE_TMUX_SOCK kill-server 2>/dev/null
  [[ -n $FIXTURE_TMUX_SOCK ]] && rm -f /private/tmp/tmux-$(id -u)/$FIXTURE_TMUX_SOCK
  FIXTURE_TMUX_SOCK=""
  return 0
}
```

- [ ] **Step 2: Write the failing Rule C/D tests**

Insert into `scripts/orphan-hygiene/test-reap.zsh` before the final `fixture_cleanup`, and extend the trap:

```zsh
# Extend cleanup to cover the scratch tmux server.
trap 'fixture_cleanup; fixture_tmux_teardown' EXIT INT TERM

print "test-reap: rule C — detached childless shell pane is a husk"
fixture_tmux_socket >/dev/null
husk_sess=$(fixture_tmux_husk_session)
husk_pane=$(fixture_tmux_pane_pid $husk_sess)
if [[ -z $husk_pane ]]; then
  skip "rule C positive" "tmux fixture failed"
else
  out=$($REAP)
  assert_contains "$out" "C|$husk_pane|" "childless detached shell pane is listed"
fi

print "test-reap: rule C — detached pane running a non-shell command is spared"
live_sess=$(fixture_tmux_live_session)
live_pane=$(fixture_tmux_pane_pid $live_sess)
if [[ -z $live_pane ]]; then
  skip "rule C negative, custom agent" "tmux fixture failed"
else
  out=$($REAP)
  assert_not_contains "$out" "C|$live_pane|" "non-shell pane spared (custom agentType safe)"
fi

print "test-reap: rule C — real detached argus sessions with live agents are spared"
out=$($REAP)
found_any=0
for sock in /private/tmp/tmux-$(id -u)/argus*(N); do
  [[ ${sock:t} == argus-fixture-* ]] && continue
  # Process substitution, not a pipe — see the note in the rule B block. With a
  # pipe, both `found_any=1` and every assert_* result would be lost in a
  # subshell, so this test would silently always report "skip" and a real
  # regression (a live agent pane being listed as a husk) would never fail CI.
  while IFS='|' read -r rattached rpane; do
    [[ $rattached == 0 ]] || continue
    [[ $rpane == <-> ]] || continue
    rcomm=${$(ps -p $rpane -o comm= 2>/dev/null):t}
    if [[ -n $rcomm && $rcomm != (zsh|bash|sh) ]]; then
      found_any=1
      assert_not_contains "$out" "C|$rpane|" "live detached agent pane $rpane ($rcomm) spared"
    fi
  done < <($TMUX_BIN -L ${sock:t} list-panes -a -F '#{session_attached}|#{pane_pid}' 2>/dev/null)
done
(( found_any )) || skip "real detached agent panes spared" "no live detached argus sessions present"

print "test-reap: rule D — socket file with no server is listed"
fixture_tmux_teardown          # kills the server, may leave the socket file behind
dead_sock=/private/tmp/tmux-$(id -u)/argus-fixture-dead-$$
: > $dead_sock
out=$($REAP)
assert_contains "$out" "$dead_sock" "orphaned socket file is listed"
rm -f $dead_sock
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `zsh scripts/orphan-hygiene/test-reap.zsh`
Expected: FAIL on "childless detached shell pane is listed" — no `C|` or `D|` records exist yet.

- [ ] **Step 4: Implement Rules C and D**

In `$HOME/.claude/bin/orphan-reap`, add near the top after `CPU_MIN`:

```zsh
typeset -g TMUX_BIN=${TMUX_BIN:-$(command -v tmux || print /opt/homebrew/bin/tmux)}
```

And add after `find_watchdog_husks`:

```zsh
# Emits: C|<pane_pid>|<age>|-|<description>  and  D|-|-|-|<socket path>
#
# A husk is a detached session whose pane process is a bare shell with NO
# children — i.e. the agent exited and left the shell behind. Deliberately not
# "the pane command is not claude/gemini/codex": Argus's AgentRegistry supports
# custom agentType values, and any whitelist would misclassify a custom agent's
# live pane as a husk and kill real work. Childlessness is registry-agnostic.
find_tmux_husks() {
  local sock name attached pane_pid comm age
  for sock in /private/tmp/tmux-$(id -u)/argus*(N); do
    name=${sock:t}
    if ! $TMUX_BIN -L $name list-sessions >/dev/null 2>&1; then
      print -r -- "D|-|-|-|dead tmux socket file: $sock"
      continue
    fi
    $TMUX_BIN -L $name list-panes -a -F '#{session_name}|#{session_attached}|#{pane_pid}' 2>/dev/null |
    while IFS='|' read -r sess attached pane_pid; do
      [[ $attached == 0 ]] || continue
      [[ $pane_pid == <-> ]] || continue
      comm=${$(ps -p $pane_pid -o comm= 2>/dev/null):t}
      [[ $comm == (zsh|bash|sh) ]] || continue
      [[ -z $(pgrep -P $pane_pid 2>/dev/null) ]] || continue
      age=$(ps -p $pane_pid -o etime= 2>/dev/null | tr -d ' ')
      print -r -- "C|$pane_pid|$age|-|tmux husk: $name/$sess (detached, childless $comm)"
    done
  done
}
```

Extend the findings assembly:

```zsh
findings=(
  ${(f)"$(find_burner_husks)"}
  ${(f)"$(find_watchdog_husks)"}
  ${(f)"$(find_tmux_husks)"}
)
findings=(${findings:#})
```

Handle category D in the kill path — it unlinks a file rather than signalling a PID. Replace the `to_kill` loop with:

```zsh
typeset -a to_kill
typeset -a to_unlink
for f in $findings; do
  local cat=${${(s:|:)f}[1]}
  local pid=${${(s:|:)f}[2]}
  if [[ $cat == D ]]; then
    to_unlink+=(${f##*: })
  elif [[ $pid == <-> ]]; then
    to_kill+=($pid)
  fi
done
```

And after the SIGKILL block:

```zsh
if (( ${#to_unlink} )); then
  print "orphan-reap: unlinking ${#to_unlink} dead socket file(s)"
  rm -f ${to_unlink}
fi
```

Add to `usage()` Categories:

```
  C  tmux husk           detached argus session whose pane is a bare shell with no children
  D  dead socket file     /private/tmp/tmux-*/argus* socket with no server answering
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `zsh scripts/orphan-hygiene/test-reap.zsh`
Expected: PASS, `fail=0`.

- [ ] **Step 6: Verify the highest-consequence invariant by hand**

Run: `$HOME/.claude/bin/orphan-reap`
Expected: the three live detached `argus-dev` sessions (pane PIDs running `claude`) appear **nowhere** in the output. If any `C|` line names a pane whose `ps -p <pid> -o comm=` is a `claude`/`gemini`/`codex`/custom agent binary, stop — the rule is wrong and killing on it would destroy live agent work.

- [ ] **Step 7: Verify the real sockets were untouched**

Run: `ls /private/tmp/tmux-$(id -u)/` and `tmux -L argus-dev list-sessions`
Expected: `argus`, `argus-dev`, `argus-uitest` still present; `argus-dev` still lists its sessions. No `argus-fixture-*` sockets remain.

- [ ] **Step 8: Commit**

```bash
git add scripts/orphan-hygiene/fixtures.zsh scripts/orphan-hygiene/test-reap.zsh
git commit -m "feat(tooling): orphan-reap rules C and D for tmux husks

Rule C tests for a detached session whose pane is a bare childless shell,
not for the absence of a known agent binary. A whitelist would misclassify
a custom AgentRegistry agentType as a husk and kill live work; childlessness
is registry-agnostic.

Fixtures run on their own argus-fixture-* socket so the real argus,
argus-dev and argus-uitest servers are never touched. The negative test
uses a non-shell pane command standing in for a custom agent."
```

---

### Task 5: Kill semantics and report-only guarantee

**Files:**
- Modify: `scripts/orphan-hygiene/test-reap.zsh`
- Modify: `$HOME/.claude/bin/orphan-reap` (add the `ORPHAN_REAP_TMUX_DIR` seam below; otherwise only if a test exposes a defect)

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces: `ORPHAN_REAP_TMUX_DIR`, an override for the tmux socket-discovery root, defaulting to `/private/tmp/tmux-$(id -u)`. Otherwise no new interface. Locks the `--yes` contract and the report-only default with tests.

> **Scope the kill test to its own fixtures — ruled on by the human partner.** As originally
> written, this task ran a blanket `orphan-reap --yes`, which reaps *real machine state*, not just
> fixtures. On the development machine that included two genuine dead socket files
> (`/private/tmp/tmux-501/argus` and `/private/tmp/tmux-501/argus-uitest`), so the suite would have
> deleted real files as a side effect of proving that a fixture burner dies. A test suite must not
> mutate things it did not create.
>
> Rules A and B cannot produce collateral here — a real category-A or category-B finding *is* a
> genuine orphan, and killing it is the tool doing its job. Only category D reaches non-fixture
> state, through the hardcoded socket glob. So the minimal seam is to make that root overridable.
>
> In `find_tmux_husks`, replace the hardcoded glob root with an override that keeps today's value
> as the default:
>
> ```zsh
> typeset -g TMUX_SOCKET_DIR=${ORPHAN_REAP_TMUX_DIR:-/private/tmp/tmux-$(id -u)}
> # ...
> for sock in $TMUX_SOCKET_DIR/argus*(N); do
> ```
>
> The kill test then points that root at an empty scratch directory, so `--yes` can only reach the
> fixture burner it created. Assert explicitly that both real socket files still exist afterwards —
> that assertion is the regression guard for this ruling.
>
> Also add the `ORPHAN_REAP_CPU_MIN` coverage the Task 2 review found missing: with the threshold
> raised above a live fixture burner's CPU, rule A must not list it; at the default it must.
>
> **Use `-S "$sock"` in the seam, not `-L "${sock:t}"`** — see Amendment 3. With `-L`, the seam would
> glob fixture sockets in the scratch dir and then probe the *real* dir, classifying every fixture as
> dead: rule C would be silently dead in the scoped suite while the D-side assertions passed.

#### Task 5 also carries these, accumulated from the Task 2 and Task 4 reviews

**HARD REQUIREMENT — N5: `_c_still_husk` has zero test coverage.** Verified: `--yes` appears in the
suite only inside assertion *strings*, never as an invocation, so both re-check gates
(`orphan-reap:227` before `kill`, `:243` after the `sleep 2` before `kill -9`) are never executed.
Replacing the function body with `return 0` leaves the suite green at `pass=24`. That silently reverts
the tool to pre-I5 behaviour, re-opening the TOCTOU window I5 exists to close — and it puts the guard
that decides whether a pid gets signalled in the one path no test touches. This is N2's shape (green
suite, uncovered branch) relocated into the destructive path. Strongest honest form first:

1. A fixture-scoped `--yes` run that creates a husk pane, makes it childful between classification and
   signalling, and asserts a `spared on re-check` line appears.
2. Failing that, a static assertion that `_c_still_husk` is referenced at both signalling sites.

**Report-only lock needs a static guard.** C1's fix has no automated protection, and running `--yes`
unscoped in-suite is itself the hazard. Zero-risk form: assert the tool's text contains no `to_unlink`
and no `rm ` in the kill path.

**Per-group assertion counters (from the Q1 analysis).** `pass=N` is not a usable regression signal:
the per-loop breakdown is hand-authored in the report, so it cannot fail and drifts with ambient state.
**Two** groups are environment-dependent, not one — the rule-B watchdog loop (MCP churn) and the
rule-C real-session loop (however many detached `argus-dev` sessions happen to exist). The fixed core
is **11**: A 2 + default-kills-nothing 1 + B 2 + C 3 + D 1 + `?` 2. Have the two ambient loops
increment their own named counters, make `summary` print per-group lines, and **assert the fixed core
equals 11** — that assertion is the real signal, because it catches a whole block being silently
skipped, which no total can. Until then `fail=0 skip=0` is the signal and `pass=N` is informational.

**S5 — fix the spared-on-re-check message.** For a pid that has already exited, `comm` is empty, so it
prints `spared on re-check: 1234 is now  with children` — a double space plus a claim that is untrue.
Same text appears when `pgrep` is missing. Add a `kill -0` check for "already gone" and an else-branch
for the inconclusive case. This is operator-facing text in the destructive path, where wrong messages
cost the most.

**S8 — quote the needle in `assert.zsh`.** Line 18 is `[[ $haystack == *$needle* ]]`, with the needle
unquoted inside the pattern. That is safe today only because zsh's `NO_GLOB_SUBST` default stops
expanded parameters being re-read as patterns. Round 2 introduced the first needles containing glob
metacharacters — `?|-|-|-|…`, `(report-only …)`, and `|` throughout — so under `setopt glob_subst`,
`emulate sh`, or a port to bash, `?` becomes a wildcard and `(…)`/`|` become alternation, and those
assertions silently change meaning. Use `*"$needle"*`.

**S6 / S7 — take if cheap.** S6: the numeric field-2 predicate is computed in two loops
(`orphan-reap:173-175` and `:193-200`) and can drift; build `to_kill`/`cat_of` once, then
`actionable=${#to_kill}`. S7: `local gc=$(pgrep -P $p …)` — zsh doesn't word-split unquoted
parameters, so a pane with more than one child hands `_fixture_record` a single argument containing a
newline; use `for gc in ${(f)"$(pgrep -P $p)"}; do _fixture_record $gc; done`.

- [ ] **Step 1: Write the failing kill-semantics tests**

Insert into `scripts/orphan-hygiene/test-reap.zsh` before the final `fixture_cleanup`:

```zsh
print "test-reap: --yes kills a burner husk"
victim=$(fixture_spawn_orphan_burner)
if [[ -z $victim ]]; then
  skip "--yes kills" "fixture failed to spawn"
else
  sleep 1
  $REAP --yes >/dev/null 2>&1
  sleep 1
  kill -0 $victim 2>/dev/null
  assert_eq $? 1 "--yes killed the orphaned burner"
fi

print "test-reap: exit codes and argument handling"
assert_exit 0 "default run exits 0"        $REAP
assert_exit 0 "--help exits 0"             $REAP --help
assert_exit 2 "unknown argument exits 2"   $REAP --wat

print "test-reap: help text names the safe load-test idiom"
out=$($REAP --help)
assert_contains "$out" "burn.sh" "help points at burn.sh"
```

- [ ] **Step 2: Run the test to verify it behaves as expected**

Run: `zsh scripts/orphan-hygiene/test-reap.zsh`
Expected: these assertions PASS against the Task 2–4 implementation. If any fails, fix `orphan-reap` — do not weaken the assertion. The report-only default and exit-0 contract are the safety properties of the whole tool.

- [ ] **Step 3: Verify the full suite together**

Run: `zsh scripts/orphan-hygiene/test-burn.zsh && zsh scripts/orphan-hygiene/test-reap.zsh`
Expected: both `fail=0`.

- [ ] **Step 4: Verify nothing leaked from the whole suite**

Run:
```bash
ps -eo pid,ppid,pcpu,command | grep -E 'snapshot-zsh-fixture|argus-fixture' | grep -v grep
ls /private/tmp/tmux-$(id -u)/
```
Expected: no fixture processes; no `argus-fixture-*` sockets.

- [ ] **Step 5: Commit**

```bash
git add scripts/orphan-hygiene/test-reap.zsh
git commit -m "test(tooling): lock orphan-reap kill semantics and report-only default

Asserts --yes actually kills, the default run never does, unknown args
exit 2, and the help text points at burn.sh as the safe load-test idiom."
```

---

### Task 6: Document the rule in Argus CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (the Commands section)

**Interfaces:**
- Consumes: `burn.sh` and `orphan-reap` from Tasks 1–5.
- Produces: nothing executable. This is the discoverability half of the fix — without it a future session writes the unsafe idiom again.

- [ ] **Step 1: Read the current Commands section**

Run: `grep -n '^## Commands' -A 30 CLAUDE.md`
Expected: the existing fenced block of `npm` commands, followed by the CI paragraph.

- [ ] **Step 2: Add the load-testing rule**

Insert immediately after the CI paragraph in the Commands section (before the `dev:web` escape-hatch paragraph):

```markdown
### Load testing (flaky-test investigation)

To run a test under CPU saturation, **always** source the self-terminating burner:

```bash
source ~/.claude/bin/burn.sh
burn 60                     # saturates all cores, each burner expires after 60s
npx tsx --test server/src/services/StateDetector.classify.test.ts
kill $BURNERS 2>/dev/null   # optional early release
```

**Never** write a bare `(while :; do :; done) &`. On 2026-08-04 that idiom left 22
orphaned burners at load average 118 on 11 cores. The script's cleanup was broken
three independent ways, all since verified:

1. `BURNERS=$(jobs -p | tr '\n' ' ')` — command substitution runs in a subshell with
   no job table, so `BURNERS` was always empty.
2. `kill $BURNERS` — zsh does not word-split unquoted scalars, so even a populated
   scalar reaches `kill` as a single argument and fails with `illegal pid`.
3. The driver shell then died before reaching that (already inert) cleanup line.

So the cleanup could never have worked under any circumstances. The lesson is not
"remember to clean up" — it is **make the burner expire on its own**. `burn` puts an
absolute deadline inside each subshell, and `BURNERS` is a zsh **array**, which is
what makes the documented `kill $BURNERS` actually work.

`~/.claude/bin/orphan-reap` reports orphaned burners, MCP watchdogs with dead
parents, and tmux husks. It **kills nothing without `--yes`**, and it **never unlinks
socket files at all**, even with `--yes` — a tmux server cannot recreate its socket,
so unlinking a live one would leave it running but permanently unattachable. Dead
sockets are reported for you to remove by hand. Both scripts live in `~/.claude/bin`
and are **not** part of this repo, so a fresh clone gets this rule but not the tools —
a deliberate tradeoff recorded in
`docs/superpowers/specs/2026-08-04-orphan-process-hygiene-design.md`.
```

- [ ] **Step 3: Verify the markdown nests correctly**

Run: `grep -n 'burn 60' -B 8 -A 8 CLAUDE.md`
Expected: the inner fenced block renders inside the new `###` subsection without breaking the surrounding Commands fences. The outer document must still have balanced code fences — count them: `grep -c '^```' CLAUDE.md` should be even.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: require the self-terminating burner for load tests

Names burn.sh as the only sanctioned way to saturate cores for flaky-test
investigation, and the bare backgrounded infinite loop as the thing that
caused the 2026-08-04 load-118 incident."
```

---

### Task 7: Final verification against the spec

> **Added after the Task 6 review — the spec and `burn.sh`'s header have drifted from what shipped,
> and `CLAUDE.md` now cites a spec that contradicts it.** Fix all four before the final walkthrough;
> the spec is the design record and is currently wrong in three places.
>
> 1. **Spec "Problem" section** tells the single-defect story ("the driver shell died before its `kill`
>    line ran"). Replace with the three verified defects, matching `CLAUDE.md`'s account: empty
>    `$(jobs -p)` capture, unsplittable scalar (`illegal pid`), and only then the driver's death.
> 2. **Spec's proposed `burn.sh` pseudocode** still contains `BURNERS=$(jobs -p | tr '\n' ' ')` — the
>    exact line defect #1 identifies as fatally broken. Replace with the shipped array form
>    (`typeset -ga BURNERS=()` / `BURNERS+=($!)`).
> 3. **Spec's `--yes` description** says "Category D unlinks the socket file". The code never unlinks,
>    by deliberate ruling — a tmux server cannot recreate its socket, so unlinking a live one leaves it
>    running but permanently unattachable. Correct it, and state why.
> 4. **`~/.claude/bin/burn.sh`'s own header comment** tells the same single-defect story. A future
>    session opening the file to source it lands on the narrower account. Bring it in line.
>
> Rationale for doing this here rather than deferring: `CLAUDE.md` explicitly cites the spec for "the
> full rationale", so a reader who follows that citation currently finds a contradicting account and a
> code sample the rule tells them never to write. Documentation drift is how a code-enforced safety
> property degrades into folklore.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-orphan-process-hygiene-design.md` (items 1-3)
- Modify: `$HOME/.claude/bin/burn.sh` (item 4, comment only — do not touch the code)

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a verification record in the PR/commit description.

- [ ] **Step 1: Run the full suite from a clean shell**

Run: `zsh scripts/orphan-hygiene/test-burn.zsh && zsh scripts/orphan-hygiene/test-reap.zsh`
Expected: both `fail=0`, and any `skip` lines are explained by genuinely absent preconditions (e.g. no detached argus sessions on this machine), not by broken fixtures.

- [ ] **Step 2: Walk the spec's 8 verification cases**

Open `docs/superpowers/specs/2026-08-04-orphan-process-hygiene-design.md` and confirm each of the 8 numbered cases maps to a passing assertion:

| Spec case | Covered by |
|---|---|
| 1. Burner self-terminates when orphaned | Task 1, "orphaned burners expired on their own deadline" |
| 2. `burn` rejects out-of-range input | Task 1, three `assert_exit 1` cases |
| 3. Rule A positive | Task 2, "rule A lists the orphaned burner" |
| 4. Rule A negative | Task 2, "parented burner is not listed" |
| 5. Rule B negative | Task 3, "live-parent watchdog N spared" (one per real watchdog) |
| 6. Rule C negative, real sessions | Task 4, "live detached agent pane N spared" |
| 7. Rule C negative, custom agent | Task 4, "non-shell pane spared (custom agentType safe)" |
| 8. Report-only default | Task 2 "orphan survives a default run" + Task 5 exit-code cases |

- [ ] **Step 3: Confirm the shared checkout was never touched**

Run:
```bash
cd /Users/macbookpro10/development/projects/argus && git status --short && git branch --show-current
```
Expected: whatever branch the concurrent session left it on, with its own uncommitted state intact. This plan must not have changed it. If it differs from when you started, something in an earlier task ran `git` in the wrong directory.

- [ ] **Step 4: Push the branch**

```bash
cd /Users/macbookpro10/development/projects/argus-orphan-hygiene
git push -u origin chore/orphan-process-hygiene
```

---

## Notes for the implementer

- **The scripts are not in the repo.** `burn.sh` and `orphan-reap` install to `$HOME/.claude/bin`, which does not exist until Task 1 Step 4 creates it. Only the tests and the `CLAUDE.md` rule are committed. This is a deliberate decision recorded in the spec, with its tradeoff noted there.
- **`ps -o comm=` returns a full path**, e.g. `/Users/x/.local/bin/claude`, not `claude`. Every comparison against a shell name must take the basename (`${...:t}`), or Rule C silently matches nothing.
- **`session_attached` is available inside `list-panes -a -F`** — verified. No separate `list-sessions` pass is needed.
- **Never run `git` commands in `~/development/projects/argus`.** Other Claude Code sessions actively share that working tree; during the design of this plan it moved from `fix/settings-and-tile-header` to `feat/keep-awake-cta` to `main` within one hour. All work belongs in the worktree.
- **Fixtures must always self-limit.** Every synthetic burner carries a 60s deadline in addition to `fixture_cleanup`, so a crashed test run cannot recreate the very problem this tooling exists to prevent.
