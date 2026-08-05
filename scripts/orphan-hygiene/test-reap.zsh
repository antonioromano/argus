#!/bin/zsh
# Tests for orphan-reap — run: zsh scripts/orphan-hygiene/test-reap.zsh
emulate -L zsh

SCRIPT_DIR=${0:A:h}
source $SCRIPT_DIR/assert.zsh
source $SCRIPT_DIR/fixtures.zsh

BIN=${ORPHAN_HYGIENE_BIN:-$HOME/.claude/bin}
REAP=$BIN/orphan-reap

# Scratch directory for every --yes invocation in this suite (N5's hard
# requirement, reinforced separately by the team lead): a blanket
# `orphan-reap --yes` reaps real machine state, so no --yes call below ever
# runs against the real /private/tmp/tmux-$(id -u) — each one gets
# ORPHAN_REAP_TMUX_DIR pointed at this empty (or fixture-only) directory
# instead. Rules A/B are unaffected by this var (they scan the whole process
# table, not a tmux socket dir) — scoping it anyway costs nothing and closes
# off rule C/D as a source of collateral for every --yes call uniformly,
# rather than trusting each call site to remember to do it.
SCRATCH_TMUX_DIR=$(mktemp -d)

trap 'fixture_cleanup; fixture_tmux_teardown; fixture_tmux_teardown_dir $SCRATCH_TMUX_DIR' EXIT INT TERM

group "A"
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

group "default_kills_nothing"
print "test-reap: default run kills nothing"
if [[ -n $orphan_pid ]]; then
  kill -0 $orphan_pid 2>/dev/null
  assert_eq $? 0 "orphan survives a default (report-only) run"
fi

group "B"
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

group "B_ambient"
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

group "C"
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

# I1: the childlessness clause has no other test that fails if it's deleted —
# the husk positive passes on comm+childless together, the /bin/cat negative
# passes on comm alone, and (pre-fix) the real-session loop below skipped
# every shell pane outright. This is the one exercising the exact PtyManager
# shape: pane stays a shell, but has a live child.
print "test-reap: rule C — detached shell pane WITH a child is spared (PtyManager shape)"
child_sess=$(fixture_tmux_shell_with_child)
child_pane=$(fixture_tmux_pane_pid $child_sess)
if [[ -z $child_pane ]]; then
  skip "rule C negative, shell with child" "tmux fixture failed"
else
  # N4: the trailing `:` that keeps this pane's comm at `zsh` (instead of
  # exec-eliding into a bare `sleep`) is load-bearing and otherwise
  # unasserted. Without this guard, a future zsh that elides differently
  # would turn the pane into a non-shell `sleep`, the comm gate in rule C
  # would filter it out for an unrelated reason, and assert_not_contains
  # below would keep passing forever — a silent, permanent false negative
  # for the exact property this fixture exists to exercise. Fail loud (skip)
  # instead, so the fixture's own precondition failing is visible.
  fixture_comm=${$(ps -p $child_pane -o comm= 2>/dev/null):t}
  fixture_children=$(pgrep -P $child_pane 2>/dev/null)
  if [[ $fixture_comm != (zsh|bash|sh) || -z $fixture_children ]]; then
    skip "rule C negative, shell with child" "fixture no longer produces a childful shell pane (comm=$fixture_comm children=${fixture_children:-none})"
  else
    out=$($REAP)
    assert_not_contains "$out" "C|$child_pane|" "childful shell pane spared (childlessness, not comm, gates rule C)"
  fi
fi

group "C_ambient"
print "test-reap: rule C — real detached argus sessions with live agents/panes are spared"
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
    [[ -n $rcomm ]] || continue
    if [[ $rcomm != (zsh|bash|sh) ]]; then
      found_any=1
      assert_not_contains "$out" "C|$rpane|" "live detached agent pane $rpane ($rcomm) spared"
    elif [[ -n $(pgrep -P $rpane 2>/dev/null) ]]; then
      # A real shell pane WITH children — assert spared instead of skipping
      # it, so this loop also covers I1's property against real machine state.
      found_any=1
      assert_not_contains "$out" "C|$rpane|" "live detached shell-with-child pane $rpane ($rcomm) spared"
    fi
  done < <($TMUX_BIN -S "$sock" list-panes -a -F '#{session_attached}|#{pane_pid}' 2>/dev/null)
done
(( found_any )) || skip "real detached agent panes spared" "no live detached argus sessions present"

# N2: the original version of this test did `: > $dead_sock` — a plain
# regular file, not a real tmux socket. tmux's actual reply to that is
# "Socket operation on non-socket", which does NOT match D1's dead-socket
# patterns, so it was classified `?`, not `D`. `assert_contains "$out"
# "$dead_sock"` matched the `?` line's path just as happily as it would have
# matched a `D` line, so this test passed with ZERO coverage of the `D`
# branch: deleting D1's match list entirely (the exact regression D1 exists
# to prevent) would have left this suite green. Fixed by exercising a REAL
# crashed server — kill -9 the server process directly (never kill-server),
# which is what actually produces "no server running on <path>" and, on
# this tmux (3.6b), leaves the socket file behind. The plain-file case is
# kept as its own test, now correctly asserting `?`, not `D`.
group "D"
print "test-reap: rule D — socket left behind by a crashed server is listed as dead"
# Addendum note: this reuses the scratch socket from the rule-C tests above,
# whose panes (husk_pane/live_pane/child_pane) were each already
# _fixture_record'd by their own spawn fixtures BEFORE we got here — so
# fixture_cleanup can reap them by pid directly even though the server we're
# about to kill can no longer enumerate or signal them itself. Do NOT "fix"
# this by moving the kill -9 earlier or reordering fixture creation; the
# pane-recording-before-kill invariant already holds by construction.
srv_pid=$($TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" display-message -p '#{pid}' 2>/dev/null)
if [[ -z $srv_pid ]]; then
  skip "rule D positive" "could not resolve the scratch tmux server pid"
else
  kill -9 $srv_pid 2>/dev/null
  sleep 0.3
  out=$($REAP)
  assert_contains "$out" "D|-|-|-|dead tmux socket file (report-only — never unlinked by --yes): $FIXTURE_TMUX_SOCK_PATH" "crashed server's leftover socket is listed as D"
fi

group "unknown"
print "test-reap: rule ? — a non-socket leftover file at a socket path is inconclusive, not dead"
noise_sock=/private/tmp/tmux-$(id -u)/argus-fixture-noise-$$
: > $noise_sock
out=$($REAP)
assert_contains "$out" "?|-|-|-|inconclusive tmux socket probe, investigate by hand: $noise_sock" "plain-file leftover is reported as inconclusive"
assert_not_contains "$out" "D|-|-|-|dead tmux socket file (report-only — never unlinked by --yes): $noise_sock" "plain-file leftover is never classified as dead"
rm -f $noise_sock

# --- Task 5: kill semantics and the report-only guarantee ---------------

group "static_guard"
print "test-reap: report-only lock — no unlink path exists in the kill path"
# C1: rule D used to unlink sockets under --yes; that fix (D1) has no
# automated protection of its own. Zero-risk static guard: the kill path
# (everything from the report-only branch onward) must never mention
# to_unlink or invoke rm. Scoped to that region, not the whole file — the
# --help text above legitimately contains the unrelated word "form", which
# contains the literal substring "rm " and would be a false positive over
# the full file.
kill_path=$(sed -n '/^if (( ! DO_KILL/,$p' $REAP)
assert_not_contains "$kill_path" "to_unlink" "C1 guard: no to_unlink construct in the tool"
assert_not_contains "$kill_path" "rm " "C1 guard: no rm invocation in the kill path"

group "cpu_min"
print "test-reap: ORPHAN_REAP_CPU_MIN gates rule A"
cpu_pid=$(fixture_spawn_orphan_burner)
if [[ -z $cpu_pid ]]; then
  skip "ORPHAN_REAP_CPU_MIN coverage" "fixture failed to spawn"
else
  sleep 1
  burner_cpu=$(ps -p $cpu_pid -o pcpu= 2>/dev/null | tr -d ' ')
  burner_cpu_int=${burner_cpu%%.*}
  if [[ $burner_cpu_int != <-> ]]; then
    skip "ORPHAN_REAP_CPU_MIN coverage" "could not read the fixture burner's %CPU"
  else
    above=$(( burner_cpu_int + 50 ))
    out=$(ORPHAN_REAP_CPU_MIN=$above $REAP)
    assert_not_contains "$out" "A|$cpu_pid|" "rule A spares the burner once ORPHAN_REAP_CPU_MIN is raised above its %CPU"
    out=$(ORPHAN_REAP_CPU_MIN=20 $REAP)
    assert_contains "$out" "A|$cpu_pid|" "rule A lists the same burner at the default ORPHAN_REAP_CPU_MIN"
  fi
fi

group "yes_kill"
print "test-reap: --yes kills a burner husk"
victim=$(fixture_spawn_orphan_burner)
if [[ -z $victim ]]; then
  skip "--yes kills" "fixture failed to spawn"
else
  sleep 1
  # Deviation from the brief's literal snippet: every --yes call is scoped
  # via ORPHAN_REAP_TMUX_DIR per the team lead's safety mandate, even here
  # where rule A (process-table-wide) is what's actually under test — see
  # the SCRATCH_TMUX_DIR comment above.
  ORPHAN_REAP_TMUX_DIR=$SCRATCH_TMUX_DIR $REAP --yes >/dev/null 2>&1
  sleep 1
  kill -0 $victim 2>/dev/null
  assert_eq $? 1 "--yes killed the orphaned burner"
fi

group "n5"
print "test-reap: N5 — _c_still_husk spares a pane that becomes childful before signalling completes"
fixture_tmux_socket_in $SCRATCH_TMUX_DIR >/dev/null
survivor_sess=$(fixture_tmux_husk_survivor_session)
survivor_pane=$(fixture_tmux_pane_pid $survivor_sess)
if [[ -z $survivor_pane ]]; then
  skip "N5 spared on re-check" "tmux fixture failed to spawn"
else
  out=$(ORPHAN_REAP_TMUX_DIR=$SCRATCH_TMUX_DIR $REAP --yes 2>&1)
  assert_contains "$out" "spared on re-check: $survivor_pane" "N5: _c_still_husk spares a pane that gained a child mid-signal"
  kill -0 $survivor_pane 2>/dev/null
  assert_eq $? 0 "N5: the spared pane survives the run"
fi
# Tear this fixture's socket down immediately rather than waiting for the
# final trap — its pane stays alive indefinitely (the outer `while` loop
# never exits) and would otherwise still be sitting on $SCRATCH_TMUX_DIR,
# childless again once its 60s injected child exits, for any later --yes
# call in this file to find and legitimately reap.
fixture_tmux_teardown_dir $SCRATCH_TMUX_DIR
SCRATCH_TMUX_DIR=$(mktemp -d)

group "exit_codes"
print "test-reap: exit codes and argument handling"
assert_exit 0 "default run exits 0"        $REAP
assert_exit 0 "--help exits 0"             $REAP --help
assert_exit 2 "unknown argument exits 2"   $REAP --wat

group "help_text"
print "test-reap: help text names the safe load-test idiom"
out=$($REAP --help)
assert_contains "$out" "burn.sh" "help points at burn.sh"

# --- Fixed-core regression signal (Q1 analysis) --------------------------
# pass=N alone drifts silently: it cannot fail if a whole rule's block goes
# dark (every fixture in it failing to spawn, a rule's tests being deleted,
# etc.) as long as *something else* in the suite still passes. The two
# environment-dependent groups (B_ambient, C_ambient) are excluded on
# purpose — their assertion count legitimately varies with ambient machine
# state (MCP watchdog churn, however many detached argus-dev sessions
# exist). Everything else is fixed by construction: A 2 + default 1 + B 2 +
# C 3 + D 1 + unknown 2 = 11. This assertion is intentionally untagged
# (group_none) so it does not recursively feed into the very counters it is
# checking.
group_none
fixed_core=$(( GROUP_PASS[A] + GROUP_PASS[default_kills_nothing] + GROUP_PASS[B] + GROUP_PASS[C] + GROUP_PASS[D] + GROUP_PASS[unknown] ))
assert_eq $fixed_core 11 "fixed-core groups (A+default+B+C+D+unknown) total 11 passing assertions"

fixture_cleanup
summary
