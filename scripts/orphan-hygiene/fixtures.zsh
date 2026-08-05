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

# Scratch tmux server on its own argus-prefixed socket so the reaper's
# /private/tmp/tmux-$(id -u)/argus* glob picks it up. Never touches the real
# argus / argus-dev / argus-uitest sockets.
#
# No nohup here, unlike the burner/watchdog fixtures above: `tmux new-session
# -d` daemonizes the tmux server (if one isn't already running on that
# socket), so the pane process is a child of the tmux server, not of the
# calling subshell that $(fixture_tmux_husk_session) forks. The subshell
# exiting sends HUP only to ITS OWN background jobs; the tmux server and its
# panes were never in that job table. Verified empirically: a session created
# via $(...) capture and its pane process both survived well past the
# capturing subshell's exit.
typeset -g FIXTURE_TMUX_SOCK=""
typeset -g FIXTURE_TMUX_SOCK_PATH=""
typeset -g TMUX_BIN=${TMUX_BIN:-$(command -v tmux || print /opt/homebrew/bin/tmux)}

fixture_tmux_socket() {
  FIXTURE_TMUX_SOCK="argus-fixture-$$"
  FIXTURE_TMUX_SOCK_PATH="/private/tmp/tmux-$(id -u)/$FIXTURE_TMUX_SOCK"
  print -r -- $FIXTURE_TMUX_SOCK
}

# A husk: detached session whose pane is a bare childless shell.
#
# M3: guard against being called before fixture_tmux_socket — without this,
# an empty FIXTURE_TMUX_SOCK_PATH would silently create a session on
# whatever tmux's own default socket resolves to, which is exactly the
# ambient-state failure mode -S is meant to avoid.
fixture_tmux_husk_session() {
  [[ -n $FIXTURE_TMUX_SOCK ]] || return 1
  local sess="husk-$$"
  $TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" new-session -d -s $sess '/bin/zsh -f' 2>/dev/null
  sleep 1
  # M4: record the pane pid so fixture_cleanup can reap it directly if
  # kill-server ever fails to bring the whole scratch server down.
  local p=$($TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" list-panes -t $sess -F '#{pane_pid}' 2>/dev/null | head -1)
  [[ -n $p ]] && _fixture_record $p
  print -r -- $sess
}

# A live session: detached, but the pane runs a non-shell command with a child.
# `cat` stands in for a custom AgentRegistry agentType — deliberately NOT one of
# claude/gemini/codex, because rule C must not depend on an agent whitelist.
fixture_tmux_live_session() {
  [[ -n $FIXTURE_TMUX_SOCK ]] || return 1
  local sess="live-$$"
  $TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" new-session -d -s $sess '/bin/cat' 2>/dev/null
  sleep 1
  local p=$($TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" list-panes -t $sess -F '#{pane_pid}' 2>/dev/null | head -1)
  [[ -n $p ]] && _fixture_record $p
  print -r -- $sess
}

# I1: a pane that STAYS a shell but has a live child — the exact shape
# PtyManager produces (agent spawned through the user's login shell). Rule C
# must spare this. Without the fixture's trailing `:`, zsh's exec-elision
# of a `zsh -c` script's final simple command would replace the pane process
# image with a bare `sleep 300`, so the pane would stop being `zsh` at all
# and this test would pass for the wrong reason (failing the comm check,
# never reaching the childlessness check it exists to exercise).
fixture_tmux_shell_with_child() {
  [[ -n $FIXTURE_TMUX_SOCK ]] || return 1
  local sess="child-$$"
  $TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" new-session -d -s $sess '/bin/zsh -fc "sleep 300; :"' 2>/dev/null
  sleep 1
  local p=$($TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" list-panes -t $sess -F '#{pane_pid}' 2>/dev/null | head -1)
  [[ -n $p ]] && _fixture_record $p
  print -r -- $sess
}

fixture_tmux_pane_pid() {
  [[ -n $FIXTURE_TMUX_SOCK ]] || return 1
  $TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" list-panes -t $1 -F '#{pane_pid}' 2>/dev/null | head -1
}

fixture_tmux_teardown() {
  [[ -n $FIXTURE_TMUX_SOCK ]] && $TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" kill-server 2>/dev/null
  [[ -n $FIXTURE_TMUX_SOCK ]] && rm -f "$FIXTURE_TMUX_SOCK_PATH"
  # M5: prefix-locked sweep for any argus-fixture-* socket left behind by an
  # aborted run (e.g. a crash between fixture_tmux_socket and this call, or a
  # prior interrupted run whose own teardown never fired). Scoped strictly to
  # the argus-fixture- prefix — never touches argus / argus-dev / argus-uitest.
  rm -f /private/tmp/tmux-$(id -u)/argus-fixture-*(N)
  FIXTURE_TMUX_SOCK=""
  FIXTURE_TMUX_SOCK_PATH=""
  return 0
}
