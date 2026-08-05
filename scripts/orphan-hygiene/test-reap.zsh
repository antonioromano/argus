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
# C-2 (fix round 1): if mktemp fails, SCRATCH_TMUX_DIR is empty, and the
# tool's own ${ORPHAN_REAP_TMUX_DIR:-/private/tmp/tmux-$(id -u)} treats an
# empty override as unset — every --yes call below would then silently fall
# back to the real socket dir, exactly the blanket run the ruling forbids.
# Verified: `ORPHAN_REAP_TMUX_DIR= orphan-reap` lists the real
# /private/tmp/tmux-$(id -u)/argus* sockets, same as no override at all.
# Refuse outright rather than let that happen silently.
[[ -n $SCRATCH_TMUX_DIR && -d $SCRATCH_TMUX_DIR ]] || {
  print -u2 "test-reap: refusing to run --yes tests without a scratch tmux dir (mktemp -d failed)"
  summary
  exit 1
}

trap 'fixture_cleanup; fixture_tmux_teardown; fixture_tmux_teardown_dir $SCRATCH_TMUX_DIR' EXIT INT TERM

# C-1 (fix round 1): capture which of the two real dead sockets exist BEFORE
# any --yes call runs, so the regression guard placed after the last --yes
# call (see "real_socket_guard" below) has a genuine precondition to check
# against instead of assuming both are always present on every machine.
typeset -a REAL_DEAD_SOCKETS_PRESENT=()
for _s in /private/tmp/tmux-$(id -u)/argus /private/tmp/tmux-$(id -u)/argus-uitest; do
  [[ -e $_s ]] && REAL_DEAD_SOCKETS_PRESENT+=($_s)
done

# C-2 (fix round 1): prove the seam actually scopes discovery away from the
# real tmux dir BEFORE any destructive call relies on it — a report-only
# run, so nothing here can reap anything even if this assertion itself were
# wrong.
group "seam_guard"
print "test-reap: ORPHAN_REAP_TMUX_DIR seam scopes discovery away from the real tmux dir"
out=$(ORPHAN_REAP_TMUX_DIR=$SCRATCH_TMUX_DIR $REAP)
assert_not_contains "$out" "/private/tmp/tmux-$(id -u)/argus" "seam scopes socket discovery away from the real tmux dir"

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
else
  # S6 (fix round 1): consistency with every other if/else block in this
  # file — a fixture-unavailable skip instead of silently doing nothing.
  skip "default run kills nothing" "rule A fixture unavailable (orphan_pid never spawned)"
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
# Note: every block below this line runs AFTER whatever collateral rule-A/B
# reaping earlier --yes calls in this file already did (rule A/B are not
# scoped by ORPHAN_REAP_TMUX_DIR — see the SCRATCH_TMUX_DIR comment above).
# Concretely: yes_kill's --yes call also reaps any other still-live rule-A/B
# fixture from earlier in this run (e.g. the cpu_min burner, if it's still
# alive and above CPU_MIN). A fixture-negative assertion
# (assert_not_contains "A|$pid|" etc.) added below this divider would pass
# for the wrong reason — because collateral reaping already removed the
# candidate — not because the rule under test actually spared it. Put any
# new fixture-negative assertion ABOVE this divider, before the first --yes
# call, the way every existing one already is.

group "static_guard"
print "test-reap: report-only lock — no unlink path exists in the kill path"
# C1: rule D used to unlink sockets under --yes; that fix (D1) has no
# automated protection of its own. Zero-risk static guard: the kill path
# (everything from the report-only branch onward) must never mention
# to_unlink or invoke rm/unlink. kill_path is reused below (I-1) and by the
# rm/unlink checks; kill_path_code additionally strips comment-only lines so
# neither a comment mentioning these words (S7) nor the pre-existing "form "
# false positive (the --help text's unrelated word, matched by a bare "rm ")
# can produce one. to_unlink is checked over the WHOLE tool (I-2) — it has
# no legitimate use anywhere in the file, not just in the kill path, so
# scoping that check to the kill path region only would let a reintroduced
# to_unlink construct hide just above the region boundary.
kill_path=$(sed -n '/^if (( ! DO_KILL/,$p' $REAP)
kill_path_code=$(sed -n '/^if (( ! DO_KILL/,$p' $REAP | grep -v '^[[:space:]]*#')
tool_code=$(grep -v '^[[:space:]]*#' $REAP)
assert_not_contains "$tool_code" "to_unlink" "C1 guard: no to_unlink construct anywhere in the tool"
assert_not_contains "$kill_path_code" "rm " "C1 guard: no rm invocation in the kill path"
# S7: "unlink " (trailing space), not bare "unlink" — the report-only
# footer's operator-facing text legitimately says "...never killed or
# unlinked; remove..." (past-tense prose, no invocation), which a bare
# substring check would flag exactly like "form " flags "rm ". An actual
# `unlink`/`zf_unlink` invocation is always followed by a space before its
# argument, so requiring the space keeps the two apart.
assert_not_contains "$kill_path_code" "unlink " "S7 guard: no unlink/zf_unlink invocation in the kill path"

# I-1 (fix round 1): N5's fixture-based test alone can't tell WHICH of the
# two signalling-site re-checks caught the survivor pane — deleting gate 1
# (the check in the SIGTERM loop, orphan-reap:257-263) still leaves the
# suite green, because the pane still gets SIGTERMed, survives it (it traps
# SIGTERM), and gate 2 (after the sleep 2, before kill -9) catches it
# instead. A static check that BOTH signalling sites actually invoke
# _c_still_husk closes that ambiguity, independent of timing. Pattern is
# anchored on "! _c_still_husk $pid" (the exact invocation form), not the
# bare function name — a bare "_c_still_husk " substring also matches the
# S5 comment a few lines above the real invocations in the source, which
# would silently inflate this count. Deliberately group_none: a structural
# guard on the suite itself, not a coverage count that belongs in either
# the fixed-core or new-Task-5-groups total below.
group_none
assert_eq ${#${(M)${(f)kill_path}:#*'! _c_still_husk $pid'*}} 2 "both signalling sites re-check _c_still_husk"

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
    # S2 (fix round 1): exercise the ACTUAL default (env var unset), not a
    # hardcoded "20" that merely happens to match today's default and would
    # stay green even if that default ever changed.
    out=$($REAP)
    assert_contains "$out" "A|$cpu_pid|" "rule A lists the same burner at the default ORPHAN_REAP_CPU_MIN"
  fi
fi

group "yes_kill"
print "test-reap: --yes kills a burner husk"
victim=$(fixture_spawn_orphan_burner)
if [[ -z $victim ]]; then
  skip "--yes kills" "fixture failed to spawn"
elif ! kill -0 $victim 2>/dev/null; then
  # S4 (fix round 1): explicit precondition, not just "fixture returned a
  # non-empty pid" — the burner self-limits to 60s and this test doesn't run
  # first in the file, so without this check a slow suite could reach here
  # after the fixture already expired on its own deadline, and the kill
  # assertion below would then pass for the wrong reason (already dead, not
  # killed by --yes).
  skip "--yes kills" "fixture burner already gone before the --yes call"
else
  sleep 1
  # Deviation from the brief's literal snippet: every --yes call is scoped
  # via ORPHAN_REAP_TMUX_DIR per the team lead's safety mandate, even here
  # where rule A (process-table-wide) is what's actually under test — see
  # the SCRATCH_TMUX_DIR comment above.
  # S4: capture the output instead of discarding it, so we can also assert
  # the burner was actually LISTED (not just that it's dead afterward, which
  # a completely unrelated cause could also produce).
  out=$(ORPHAN_REAP_TMUX_DIR=$SCRATCH_TMUX_DIR $REAP --yes 2>&1)
  assert_contains "$out" "A|$victim|" "--yes lists the burner as a finding before killing it"
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
  # Reviewer note (fix round 1): pin the specific branch text, not just the
  # "spared on re-check" prefix — _spared_message's "has already exited"
  # branch shares that prefix too, so a bare-prefix match couldn't tell a
  # genuine "gained a child" spare from a "the pid was already gone" spare.
  assert_contains "$out" "spared on re-check: $survivor_pane is now zsh with children" "N5: _c_still_husk spares a pane that gained a child mid-signal"
  # S5 (fix round 1): the deliberately-injected `sleep 60 &` child doesn't
  # exist yet when fixture_tmux_husk_survivor_session returns (it forks
  # ~2s into the pane's own lifetime) — it can only be recorded here, at the
  # call site, after the run above has had time (>2s, thanks to the SIGTERM
  # grace sleep) for the child to actually exist. Neither leak-check pattern
  # (snapshot-zsh-fixture, argus-fixture) would ever match a stray
  # `sleep 60`, so without this nobody could tell whether it actually died
  # along with its parent below.
  survivor_child=$(pgrep -P $survivor_pane 2>/dev/null)
  [[ -n $survivor_child ]] && _fixture_record $survivor_child
  # S3 (fix round 1): kill -0 alone can report a zombie as "alive" between
  # its death and its parent reaping it — this is why the RED run below
  # showed fail=1, not fail=2: the "survives" assertion passed on a zombie
  # even though the pane had actually been SIGKILLed. Check process state
  # explicitly instead.
  survivor_state=$(ps -p $survivor_pane -o state= 2>/dev/null | tr -d ' ')
  if [[ -z $survivor_state ]]; then
    assert_eq "gone" "alive" "N5: the spared pane survives the run"
  elif [[ $survivor_state == Z* ]]; then
    assert_eq "zombie" "alive" "N5: the spared pane survives the run"
  else
    assert_eq "alive" "alive" "N5: the spared pane survives the run"
  fi
fi
# Tear this fixture's socket down immediately rather than waiting for the
# final trap — its pane stays alive indefinitely (the outer `while` loop
# never exits) and would otherwise still be sitting on $SCRATCH_TMUX_DIR,
# childless again once its 60s injected child exits, for any later --yes
# call in this file to find and legitimately reap.
fixture_tmux_teardown_dir $SCRATCH_TMUX_DIR
SCRATCH_TMUX_DIR=$(mktemp -d)
# C-2 (fix round 1): same guard as the initial mktemp above — this
# directory isn't used by any further --yes call (nothing below this point
# is destructive), but it IS what the final trap hands to
# fixture_tmux_teardown_dir, so it should never silently be empty either.
[[ -n $SCRATCH_TMUX_DIR && -d $SCRATCH_TMUX_DIR ]] || {
  print -u2 "test-reap: refusing to continue without a scratch tmux dir (mktemp -d failed)"
  summary
  exit 1
}

# C-1 (fix round 1, the brief's own required assertion): "Assert explicitly
# that both real socket files still exist afterwards — that assertion is
# the regression guard for this ruling." This was missing; a manual ls/test
# -e in a report can't fail when the scoping regresses, which is the entire
# job of an assertion. Placed after the LAST --yes call in this file (N5's,
# above) so it covers every destructive call in the suite, not just the
# first. Guarded by the before-the-run precondition captured at the top —
# a machine with neither real dead socket present skips instead of failing.
group "real_socket_guard"
print "test-reap: C1 regression guard — real dead sockets survive every --yes call in this suite"
if (( ! ${#REAL_DEAD_SOCKETS_PRESENT} )); then
  skip "real dead sockets survive --yes" "no real dead argus/argus-uitest socket present on this machine"
else
  for _s in $REAL_DEAD_SOCKETS_PRESENT; do
    if [[ -e $_s ]]; then
      assert_eq "present" "present" "real socket $_s still exists after every --yes call in this suite"
    else
      assert_eq "MISSING" "present" "real socket $_s still exists after every --yes call in this suite"
    fi
  done
fi

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

# I-4 (fix round 1): the destructive-path groups sat outside every fixed-core
# lock, so this task's own hard requirement (N5) could go dark silently: if
# its fixture ever stopped spawning, that block would emit a `skip`,
# summary() would still return 0, and the suite would stay green with N5
# completely uncovered — the exact disease fixed_core==11 exists to cure,
# just for a different set of groups. All six of these are fixed by
# construction, same as the fixed-core set above — none of them depend on
# ambient machine state.
new_core=$(( GROUP_PASS[n5] + GROUP_PASS[yes_kill] + GROUP_PASS[static_guard] + GROUP_PASS[cpu_min] + GROUP_PASS[exit_codes] + GROUP_PASS[help_text] ))
assert_eq $new_core 13 "new Task-5 groups (n5+yes_kill+static_guard+cpu_min+exit_codes+help_text) total 13 passing assertions"

fixture_cleanup
summary
