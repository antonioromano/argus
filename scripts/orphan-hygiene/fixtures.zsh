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
# M3/S1: guard against being called before fixture_tmux_socket — without
# this, an empty FIXTURE_TMUX_SOCK_PATH would silently create a session on
# whatever tmux's own default socket resolves to, which is exactly the
# ambient-state failure mode -S is meant to avoid. Guards check
# FIXTURE_TMUX_SOCK_PATH itself (S1) — that's the variable every command
# below actually consumes; FIXTURE_TMUX_SOCK alone being set would not
# catch a bug in fixture_tmux_socket that left the path unset.
fixture_tmux_husk_session() {
  [[ -n $FIXTURE_TMUX_SOCK_PATH ]] || return 1
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
  [[ -n $FIXTURE_TMUX_SOCK_PATH ]] || return 1
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
# image with a bare `sleep`, so the pane would stop being `zsh` at all and
# this test would pass for the wrong reason (failing the comm check, never
# reaching the childlessness check it exists to exercise).
#
# S4: self-limits to 60s, matching every other spawn fixture in this file —
# SIGKILLing the pane's own zsh (as fixture_cleanup does via _fixture_record)
# does not kill that zsh's own children, so without a short deadline here a
# bypassed kill-server/cleanup would leave the sleep grandchild running for
# however long its sleep argument said.
fixture_tmux_shell_with_child() {
  [[ -n $FIXTURE_TMUX_SOCK_PATH ]] || return 1
  local sess="child-$$"
  $TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" new-session -d -s $sess '/bin/zsh -fc "sleep 60; :"' 2>/dev/null
  sleep 1
  local p=$($TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" list-panes -t $sess -F '#{pane_pid}' 2>/dev/null | head -1)
  if [[ -n $p ]]; then
    _fixture_record $p
    # Record the sleep grandchild directly too (see S4 note above) — it is
    # not reaped merely by killing its parent pane. S7: zsh does not
    # word-split an unquoted parameter, so `local gc=$(pgrep -P $p)` would
    # hand _fixture_record a single argument containing an embedded newline
    # if this pane ever had more than one child; ${(f)...} splits on
    # newlines explicitly instead.
    local gc
    for gc in ${(f)"$(pgrep -P $p 2>/dev/null)"}; do
      [[ -n $gc ]] && _fixture_record $gc
    done
  fi
  print -r -- $sess
}

# For --yes tests only: places the fixture socket under an arbitrary
# directory instead of the shared real tmux socket dir
# (/private/tmp/tmux-$(id -u), where argus/argus-dev/argus-uitest also live),
# so ORPHAN_REAP_TMUX_DIR can scope a destructive run to exactly what this
# fixture created and nothing else. Never call this for the report-only
# tests above — they deliberately want the real dir so rule C/D exercise
# real machine state alongside the fixtures.
fixture_tmux_socket_in() {
  local dir=$1
  FIXTURE_TMUX_SOCK="argus-fixture-$$"
  FIXTURE_TMUX_SOCK_PATH="$dir/$FIXTURE_TMUX_SOCK"
  print -r -- $FIXTURE_TMUX_SOCK
}

# N5: a husk pane that traps SIGTERM (so it survives the first signal) and,
# a couple of seconds after it starts, forks a background child of its own —
# mimicking a PtyManager pane execing its agent between classification and
# signalling. Verified empirically that `sleep 2.5` as the delay does NOT
# work here: `sleep` is an external binary, so the delay itself forks a
# child for its whole duration, making the pane look childful from t=0 and
# leaving no genuinely-childless window for find_tmux_husks's cheap
# pre-filter to ever classify it as a finding in the first place ("nothing
# to reap" for the whole run). The delay must fork NOTHING — a builtin
# busy-wait (`SECONDS`, `while`, `:`) — so the pane is truly childless until
# the deliberate `sleep 60 &` below.
#
# The delay must clear TWO deadlines: it must still be childless when
# find_tmux_husks classifies it (this fixture's own settle `sleep 1` plus
# $(...) capture overhead puts classification at roughly 1.1-1.4s after the
# pane starts), and it must still land before the SECOND re-check, after the
# SIGTERM grace period — whichever of the two re-check sites ends up
# catching it, both print the identical "spared on re-check" text, so this
# test does not depend on which one actually fires. 2s clears classification
# with margin and lands inside the ~2s SIGTERM grace window that follows it.
#
# Every construct here is a compound command (`while`, `;`-lists ending in a
# builtin), never a bare simple command, so (per the exec-elision hazard
# documented elsewhere in this file) the pane's comm stays `zsh` throughout
# instead of being replaced by a final command's own process image.
fixture_tmux_husk_survivor_session() {
  [[ -n $FIXTURE_TMUX_SOCK_PATH ]] || return 1
  local sess="survivor-$$"
  $TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" new-session -d -s $sess \
    "/bin/zsh -f -c 'trap : TERM; end=\$((SECONDS+2)); while ((SECONDS<end)); do :; done; sleep 60 & while :; do :; done'" 2>/dev/null
  sleep 1
  local p=$($TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" list-panes -t $sess -F '#{pane_pid}' 2>/dev/null | head -1)
  [[ -n $p ]] && _fixture_record $p
  print -r -- $sess
}

# Tears down a --yes-test scratch socket directory: kill-server on every
# match first (same ordering rationale as fixture_tmux_teardown — never
# unlink a live server's socket out from under it), then remove the whole
# scratch directory. Distinct from fixture_tmux_teardown, which only ever
# sweeps the real /private/tmp/tmux-$(id -u) — this one operates on a
# caller-supplied scratch dir and is safe to rm -rf wholesale because the
# caller created that directory purely for this purpose.
fixture_tmux_teardown_dir() {
  local dir=$1
  [[ -n $dir && -d $dir ]] || return 0
  local s
  for s in $dir/argus-fixture-*(N); do
    $TMUX_BIN -S "$s" kill-server 2>/dev/null
  done
  rm -rf "$dir"
}

fixture_tmux_pane_pid() {
  [[ -n $FIXTURE_TMUX_SOCK_PATH ]] || return 1
  $TMUX_BIN -S "$FIXTURE_TMUX_SOCK_PATH" list-panes -t $1 -F '#{pane_pid}' 2>/dev/null | head -1
}

fixture_tmux_teardown() {
  # N1 (was M5): a prefix-locked sweep for any argus-fixture-* socket left
  # behind by an aborted run — this glob already covers $FIXTURE_TMUX_SOCK_PATH
  # itself, since that path always matches the argus-fixture- prefix, so there
  # is no separate named-socket step. The FIRST fix attempt here just
  # `rm -f`'d every matching socket file without killing its server first —
  # for a socket whose server is still alive (the exact case this sweep
  # exists to catch: an earlier run crashed before reaching its own
  # teardown), that reproduces the Critical this whole task exists to
  # prevent: the server keeps running, unattachable forever, invisible to
  # every future glob and every future teardown, turning a recoverable leak
  # into a permanent one. Always kill-server each match before unlinking it.
  # Scoped strictly to the argus-fixture- prefix — never touches
  # argus / argus-dev / argus-uitest.
  local s
  for s in /private/tmp/tmux-$(id -u)/argus-fixture-*(N); do
    $TMUX_BIN -S "$s" kill-server 2>/dev/null
    rm -f "$s"
  done
  FIXTURE_TMUX_SOCK=""
  FIXTURE_TMUX_SOCK_PATH=""
  return 0
}
