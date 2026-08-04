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
