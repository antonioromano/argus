#!/bin/zsh
# Tests for orphan-reap — run: zsh scripts/orphan-hygiene/test-reap.zsh
emulate -L zsh

SCRIPT_DIR=${0:A:h}
source $SCRIPT_DIR/assert.zsh
source $SCRIPT_DIR/fixtures.zsh

BIN=${ORPHAN_HYGIENE_BIN:-$HOME/.claude/bin}
REAP=$BIN/orphan-reap

trap 'fixture_cleanup; fixture_tmux_teardown' EXIT INT TERM

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

print "test-reap: rule ? — a non-socket leftover file at a socket path is inconclusive, not dead"
noise_sock=/private/tmp/tmux-$(id -u)/argus-fixture-noise-$$
: > $noise_sock
out=$($REAP)
assert_contains "$out" "?|-|-|-|inconclusive tmux socket probe, investigate by hand: $noise_sock" "plain-file leftover is reported as inconclusive"
assert_not_contains "$out" "D|-|-|-|dead tmux socket file (report-only — never unlinked by --yes): $noise_sock" "plain-file leftover is never classified as dead"
rm -f $noise_sock

fixture_cleanup
summary
