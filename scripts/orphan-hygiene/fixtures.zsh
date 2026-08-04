# Synthetic orphans for test-reap.zsh. Every spawner records its PIDs so
# fixture_cleanup can guarantee nothing outlives the test run.
emulate -L zsh

typeset -ga FIXTURE_PIDS=()

# test-reap.zsh calls the spawners as `pid=$(fixture_spawn_orphan_burner)` so it can
# capture the printed PID(s) — but $(...) always runs the function body in a forked
# subshell, and a subshell's writes to FIXTURE_PIDS (however "global" the typeset) are
# local to that subshell and vanish when it exits. Recording only into the array left
# fixture_cleanup's kill list empty and leaked two real burners on the very first run
# with real PIDs. Recording to disk survives the subshell boundary; fixture_cleanup
# reads both the file and the array so direct (non-substitution) callers still work.
typeset -g FIXTURE_PID_LOG=${FIXTURE_PID_LOG:-$(mktemp)}
: > $FIXTURE_PID_LOG

_fixture_record() {
  FIXTURE_PIDS+=($1)
  print -r -- $1 >> $FIXTURE_PID_LOG
}

# A high-CPU shell with PPID 1 whose command line contains the shell-snapshot
# marker — i.e. an exact structural match for the 2026-08-04 orphans.
# Self-limits to 60s so a crashed test run cannot leave a spinner behind.
fixture_spawn_orphan_burner() {
  local marker='/Users/x/.claude/shell-snapshots/snapshot-zsh-fixture.sh'
  local pidfile=$(mktemp)
  # Double-fork: the intermediate subshell exits at once, reparenting the burner to PID 1.
  # nohup is required here: this whole function runs inside the implicit subshell that
  # $(...) command substitution creates in test-reap.zsh, and zsh's HUP option sends
  # SIGHUP to a shell's own backgrounded jobs the instant that subshell exits — which
  # happens immediately for the intermediate subshell below. Without nohup the burner
  # is killed before it ever gets a chance to be reparented to PID 1.
  ( nohup /bin/zsh -c "# $marker
                 print \$\$ > $pidfile
                 end=\$((SECONDS+60)); while ((SECONDS<end)); do :; done" >/dev/null 2>&1 & ) 2>/dev/null
  local tries=0
  while [[ ! -s $pidfile ]] && (( tries++ < 50 )); do sleep 0.1; done
  local pid=$(< $pidfile); rm -f $pidfile
  [[ -n $pid ]] && _fixture_record $pid
  print -r -- $pid
}

# Same shape, but with a LIVE parent — Rule A must never list this one.
fixture_spawn_parented_burner() {
  local marker='/Users/x/.claude/shell-snapshots/snapshot-zsh-fixture.sh'
  local pidfile=$(mktemp)
  # nohup for the same reason as fixture_spawn_orphan_burner above: this function is
  # invoked as $(fixture_spawn_parented_burner) in test-reap.zsh, and the resulting
  # subshell's HUP-on-exit would otherwise kill this job the moment the function returns.
  nohup /bin/zsh -c "# $marker
               /bin/zsh -c '# $marker
                            print \$\$ > $pidfile
                            end=\$((SECONDS+60)); while ((SECONDS<end)); do :; done' &
               sleep 60" >/dev/null 2>&1 &
  local parent=$!
  local tries=0
  while [[ ! -s $pidfile ]] && (( tries++ < 50 )); do sleep 0.1; done
  local child=$(< $pidfile); rm -f $pidfile
  _fixture_record $parent
  [[ -n $child ]] && _fixture_record $child
  print -r -- "$parent $child"
}

# A process whose command line carries --parent-pid=<pid>, mimicking
# chrome-devtools-mcp's watchdog. Pass a dead PID to make it a husk, a live
# PID to make it healthy.
#
# The trailing `:` after `sleep 60` is load-bearing: zsh -c elides the exec of
# a script's final external command into its own process image (tail-call
# optimization), which would otherwise replace this process with a bare
# `sleep 60` and wipe the --parent-pid marker `ps` needs to see. Verified:
# without the trailing `:`, `ps` showed "sleep 60"; with it, the full
# commented script line survived.
fixture_spawn_watchdog() {
  local parent_pid=$1
  local pidfile=$(mktemp)
  nohup /bin/zsh -c "# watchdog/main.js --parent-pid=$parent_pid --app-version=0.0.0
               print \$\$ > $pidfile
               sleep 60
               :" >/dev/null 2>&1 &
  local pid=$!
  _fixture_record $pid
  local tries=0
  while [[ ! -s $pidfile ]] && (( tries++ < 50 )); do sleep 0.1; done
  local reported_pid=$(< $pidfile); rm -f $pidfile
  [[ -n $reported_pid && $reported_pid != $pid ]] && _fixture_record $reported_pid
  print -r -- ${reported_pid:-$pid}
}

# A PID that is guaranteed not to be running: spawn `true` and reap it.
fixture_dead_pid() {
  /bin/zsh -c 'exit 0' &
  local p=$!
  wait $p 2>/dev/null
  print -r -- $p
}

fixture_cleanup() {
  typeset -a pids
  pids=($FIXTURE_PIDS ${(f)"$(<$FIXTURE_PID_LOG)"})
  pids=(${(u)pids})   # dedupe
  pids=(${pids:#})    # drop empty entries
  (( ${#pids} )) && kill -9 $pids 2>/dev/null
  FIXTURE_PIDS=()
  : > $FIXTURE_PID_LOG
  return 0
}
