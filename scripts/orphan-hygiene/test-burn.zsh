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
# Assert on the actual side effect (a spawned background job), not on whether
# BURNERS was touched — the two are different claims. $jobstates is a builtin
# zsh array (one element per background job); read it directly, no fork
# involved, unlike `jobs -p` piped or captured via $(...).
jobs_before=${#jobstates}
burn 0 >/dev/null 2>&1
jobs_after=${#jobstates}
assert_eq $jobs_after $jobs_before "no background jobs spawned after rejected call"

print "test-burn: burners run and are killable early"
burn 30
assert_eq $(( ${#BURNERS} > 0 ? 1 : 0 )) 1 "burn 30 spawned at least one burner"
# `alive` is a plain global — `local` is only valid inside a function in zsh and
# would abort the script at top level.
alive=0
for p in $BURNERS; do kill -0 $p 2>/dev/null && (( alive++ )); done
assert_eq $(( alive == ${#BURNERS} ? 1 : 0 )) 1 "all spawned burners are alive"
# Exercise `kill $BURNERS` literally (not a pre-split copy) — BURNERS is an
# array, so unquoted expansion splits into multiple words on its own. A scalar
# BURNERS would make this line report "illegal pid" and kill nothing.
kill $BURNERS 2>/dev/null
sleep 1
alive=0
for p in $BURNERS; do kill -0 $p 2>/dev/null && (( alive++ )); done
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
  # I-2 (final review): without this probe, the assertion below passes
  # whether the burners died ON their 3s deadline (the property this test
  # claims to prove) or were SIGHUP-killed the instant the capturing
  # subshell exited (the failure the deadline exists to survive) — both
  # read as "alive=0 six seconds later." Probe well before the 3s deadline
  # so a still-alive result can only mean HUP didn't kill them.
  sleep 1
  alive=0
  for p in $orphans; do kill -0 $p 2>/dev/null && (( alive++ )); done
  assert_eq $alive ${#orphans} "orphaned burners are still alive before their deadline (not HUP-killed)"
  sleep 6   # deadline was 3s; 6s covers scheduling slop plus the capture wait
  alive=0
  for p in $orphans; do kill -0 $p 2>/dev/null && (( alive++ )); done
  assert_eq $alive 0 "orphaned burners expired on their own deadline"
  # Belt and braces: never leave test burners behind even if the assertion failed.
  kill -9 $orphans 2>/dev/null
fi

summary
