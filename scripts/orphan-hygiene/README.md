# orphan-hygiene test suite

Tests for `~/.claude/bin/burn.sh` and `~/.claude/bin/orphan-reap` — the self-terminating
CPU-saturation idiom and the dev-tooling orphan detector, respectively. See
`docs/superpowers/specs/2026-08-04-orphan-process-hygiene-design.md` for the design rationale and
the `CLAUDE.md` load-testing section for the user-facing rule.

**The tools themselves are not in this repo.** They install to `$HOME/.claude/bin`, outside any git
checkout, by deliberate design (see the spec's "accepted tradeoff" note). Only this test suite and
the documentation travel with the repo.

## What this suite does to your machine

This is not a hermetic unit-test suite. Running it has real, machine-wide side effects:

- **`test-burn.zsh` saturates every core** for real, repeatedly, for several seconds at a time (via
  `burn 30`, `burn 3`, etc.). Expect fan noise and a load spike while it runs.
- **`test-reap.zsh` issues real `SIGTERM`/`SIGKILL`** against real processes matching rule A
  (orphaned burner husks) and rule B (MCP-watchdog husks) findings. Rule A/B scan the *whole process
  table* and are **not** scoped by `ORPHAN_REAP_TMUX_DIR` — only rule C/D (tmux discovery) are. Every
  `--yes` call in this suite is scoped for rule C/D via `ORPHAN_REAP_TMUX_DIR`, but a `--yes` call
  made anywhere in the file can still collaterally reap any other rule-A/B finding that happens to be
  alive at that moment, including one this suite's own earlier fixtures spawned (see the "Task 5"
  divider comment in `test-reap.zsh` for the specific consequence this has for test ordering).
- **It kills a real tmux server.** The rule-D positive test does `kill -9` on a scratch tmux server's
  PID directly (never `kill-server`) to produce the exact "no server running" condition rule D
  exists to detect, and leaves the socket file behind on purpose.
- **It reads real ambient machine state.** Several groups (`B_ambient`, `C_ambient`,
  `real_socket_guard`, `real_pane_guard`) assert against whatever real MCP watchdogs, real detached
  `argus`/`argus-dev`/`argus-uitest` tmux sessions, and real dead sockets happen to exist on the
  machine right now — they are deliberately not mocked out, because the highest-consequence property
  in this whole suite (rule C never killing a live detached Argus agent) can only be proven against
  real Argus state, not a stand-in for it.

All of this is safe **by construction**, not by accident:
- Every synthetic fixture self-limits to a short deadline (see `fixtures.zsh`'s own comments) even if
  cleanup is skipped entirely.
- `fixture_cleanup` runs in an `EXIT INT TERM` trap, so an interrupted run still reaps its own
  fixtures.
- Rule C/D discovery for every `--yes` call in this file is scoped away from the real
  `/private/tmp/tmux-$(id -u)` via `ORPHAN_REAP_TMUX_DIR`, so no call in this suite can ever reap a
  real `argus`/`argus-dev`/`argus-uitest` session or a real dead socket, no matter what state the
  machine is in.
- The suite's own regression guards (`real_socket_guard`, `real_pane_guard`) assert, after every
  `--yes` call in the file, that the real sockets and real live panes present when the run started
  are still exactly as they were.

None of that makes this suite something to run casually on someone else's machine, or in an
environment you don't control. See "Why this is not in CI" below.

## How to run it

```zsh
zsh scripts/orphan-hygiene/test-burn.zsh
zsh scripts/orphan-hygiene/test-reap.zsh
```

Both are self-contained (they `source` `assert.zsh` and, for `test-reap.zsh`, `fixtures.zsh`, using
`${0:A:h}` to resolve their own directory — run them from anywhere). Both print a per-group
`pass=N fail=N skip=N` breakdown and exit non-zero if anything failed. `ORPHAN_HYGIENE_BIN` overrides
where the tools under test are found (defaults to `$HOME/.claude/bin`); `ORPHAN_REAP_CPU_MIN`
overrides rule A's `%CPU` threshold, for the tests that exercise that override specifically.

Expect the full run to take roughly a minute — most of it is deliberate `sleep`s giving %CPU time to
accumulate, giving SIGTERM its grace period, or giving a tmux pane time to settle.

## Why this is not wired into CI

`scripts/orphan-hygiene/` intentionally has no npm script and no CI job, unlike every other occupant
of `scripts/`. This suite needs things a GitHub-hosted CI runner cannot provide and should never be
asked to fake:

- **Real `argus`/`argus-dev`/`argus-uitest` tmux sockets** with real sessions on them — the
  `*_ambient` and `real_*_guard` groups assert against whatever is actually running, which on a CI
  runner is nothing, silently downgrading the suite's highest-value checks to skips with no signal
  that anything is missing.
- **Live detached Argus agent panes** — the single most important negative case (rule C must never
  list a real `claude` process's pane as a husk) only means anything against a machine that has one.
- **Real MCP-watchdog churn** (`chrome-devtools-mcp` and similar `--parent-pid=` processes) for the
  `B_ambient` group's live-parent-watchdog checks.
- **A dev machine's actual load-testing history** — this suite exists because of an incident on one
  specific machine; running it means treating that machine's state as ground truth, which is
  appropriate for the person actively maintaining this tooling and not for an ephemeral, disposable
  CI sandbox.

Run it by hand, on your own machine, when you touch `burn.sh`, `orphan-reap`, or either fixture file.

## The RED-mutation procedure

**Count locks defend against disappearance, not dilution.** A count lock (`assert_eq
$GROUP_PASS[group] N ...`) fails if a whole block goes dark — a fixture stops spawning, a group's
assertions get deleted outright. It does **not** fail if an assertion's *body* is weakened while its
count stays the same: a property test that silently degrades into an unfalsifiable tautology still
reports the same `pass=N`, green forever, with nothing in the suite's own output ever pointing at it.
This happened twice during this branch's own review history — a fixture-liveness bug held a group's
count at exactly what the lock expected while the assertion inside it proved nothing, and a similar
dilution held another group's count steady while its actual coverage of the property under test
silently disappeared. Both were caught only by deliberately breaking the real property by hand and
confirming the suite actually screamed — nowhere else, and nowhere written down before this file.

**The procedure, for any assertion whose failure mode you're not sure the suite can actually detect:**

1. **Stub the behavior the assertion claims to prove**, directly in the installed tool (never in this
   repo — `burn.sh`/`orphan-reap` live in `$HOME/.claude/bin`, so editing them there does not touch
   version control and is trivially reverted).
2. **Re-run the suite** and confirm it goes **red** — the specific assertion under test fails, not
   just "some assertion somewhere." A suite that stays green after you deliberately broke the
   property is the exact failure this procedure exists to catch.
3. **Restore the installed tool** from the working copy (or re-source it — nothing here is
   version-controlled, so there is no `git checkout` step) and re-run once more to confirm you're
   back to a clean, fully-green baseline before trusting any further result.

Three properties in this suite were validated this way and should be re-validated the same way after
any future change that touches them:

- **I1 — rule C's childlessness clause** (`fixture_tmux_shell_with_child`, the "childful shell pane
  spared (PtyManager shape)" test). Stub `orphan-reap`'s `pgrep -P $pane_pid` childlessness check in
  `find_tmux_husks` to always report "no children" (i.e. make rule C key off `comm` alone, the exact
  whitelist-shaped bug this rule was rewritten to avoid). Confirm the I1 test goes red. Without the
  RED run, nothing else in the suite proves this clause is load-bearing — the husk-positive test
  passes on comm+childless together and the `/bin/cat` negative passes on comm alone, so deleting the
  childlessness check entirely would otherwise leave the suite green.
- **N5 — both `_c_still_husk` re-check sites.** Stub one of the two invocations in `orphan-reap` (the
  pre-SIGTERM check or the pre-SIGKILL check) to skip the re-check. Confirm the N5 test — and,
  independently, the static `assert_eq ... 2 "both signalling sites re-check _c_still_husk"` count —
  both go red. The static count exists precisely because N5's fixture-based test alone cannot tell
  *which* site caught the survivor pane; deleting one site while leaving the other intact would
  otherwise stay green.
- **The `ORPHAN_REAP_TMUX_DIR` seam.** Stub `find_tmux_husks` to ignore the environment override
  (hardcode the real `/private/tmp/tmux-$(id -u)` glob). Confirm the suite's own unconditional
  refusal fires (`exit 1`, "seam did not scope discovery away from the real tmux dir") *before* any
  `--yes` call runs — this is the one RED-mutation you should expect to abort the whole script rather
  than print a `FAIL` line, which is deliberate: a broken seam must stop the suite outright, not just
  fail an assertion and continue running unscoped `--yes` calls against real machine state.

If you add a new property whose only test is a single narrow assertion, run this procedure against it
before trusting the suite to have actually locked it in.

## Known flake source (N-3)

`real_pane_guard`'s post-`--yes` check can go red for a reason that has nothing to do with this
tooling: if a real detached Argus session's pane genuinely exits *during* this suite's run — someone
quits the packaged Argus app, or an agent finishes its own session — that reads identically to a
scoping regression killing it: both show up as "gone" where the guard expected "alive." The guard
cannot distinguish "we killed it" from "it exited on its own for unrelated reasons." A red result
here needs a human to check what else was happening on the machine at the time (was Argus quit around
then?) before assuming this suite caused it.
