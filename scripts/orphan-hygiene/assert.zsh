# Shared assertion helpers for the orphan-hygiene test scripts.
# Source this, run assertions, call `summary` last.
emulate -L zsh

typeset -g ASSERT_PASS=0 ASSERT_FAIL=0 ASSERT_SKIP=0

# Per-group assertion counters (Q1 analysis): a single pass=N total is not a
# usable regression signal — a whole block of assertions being silently
# skipped (a fixture failing to spawn every time, a rule going dark) does not
# move the total in any way CI can key off. Call `group NAME` before a block
# of assertions to tag everything until the next `group` call; summary()
# prints one line per group actually used, and callers can assert on a
# specific group's total directly via $GROUP_PASS[NAME] etc.
typeset -Ag GROUP_PASS GROUP_FAIL GROUP_SKIP
typeset -g CURRENT_GROUP=""

group() {
  CURRENT_GROUP=$1
  (( ${+GROUP_PASS[$CURRENT_GROUP]} )) || GROUP_PASS[$CURRENT_GROUP]=0
  (( ${+GROUP_FAIL[$CURRENT_GROUP]} )) || GROUP_FAIL[$CURRENT_GROUP]=0
  (( ${+GROUP_SKIP[$CURRENT_GROUP]} )) || GROUP_SKIP[$CURRENT_GROUP]=0
}

# Stops tagging into any group — used around assertions that are ABOUT the
# groups (e.g. the fixed-core-equals-11 check) so they don't recursively
# inflate the very counters they are asserting on.
group_none() {
  CURRENT_GROUP=""
}

_group_tally() {   # $1 = pass|fail|skip
  [[ -n $CURRENT_GROUP ]] || return 0
  case $1 in
    pass) (( GROUP_PASS[$CURRENT_GROUP]++ )) ;;
    fail) (( GROUP_FAIL[$CURRENT_GROUP]++ )) ;;
    skip) (( GROUP_SKIP[$CURRENT_GROUP]++ )) ;;
  esac
}

assert_eq() {
  local actual=$1 expected=$2 label=$3
  # S1 (fix round 1): same rationale as S8 in assert_contains/assert_not_contains
  # below — the RHS of == is a glob pattern unless quoted, and only zsh's
  # NO_GLOB_SUBST default made this safe so far. Quote it.
  if [[ $actual == "$expected" ]]; then
    (( ASSERT_PASS++ )); _group_tally pass; print "  ok   $label"
  else
    (( ASSERT_FAIL++ )); _group_tally fail; print "  FAIL $label"; print "       expected: $expected"; print "       actual:   $actual"
  fi
}

assert_contains() {
  local haystack=$1 needle=$2 label=$3
  # S8: the needle was unquoted inside the pattern (*$needle*) — safe today
  # only because zsh's NO_GLOB_SUBST default stops an expanded parameter from
  # being re-read as a glob pattern. Round 2 introduced needles containing
  # glob metacharacters (`?`, `(...)`, `|`), so under setopt glob_subst,
  # emulate sh, or a bash port, those chars would start meaning "any char" /
  # "alternation" instead of literal text and the assertions would silently
  # change meaning. Quoting the needle keeps it literal regardless of shell
  # options.
  if [[ $haystack == *"$needle"* ]]; then
    (( ASSERT_PASS++ )); _group_tally pass; print "  ok   $label"
  else
    (( ASSERT_FAIL++ )); _group_tally fail; print "  FAIL $label"; print "       missing: $needle"; print "       in:      $haystack"
  fi
}

assert_not_contains() {
  local haystack=$1 needle=$2 label=$3
  # S8: same fix as assert_contains above.
  if [[ $haystack != *"$needle"* ]]; then
    (( ASSERT_PASS++ )); _group_tally pass; print "  ok   $label"
  else
    (( ASSERT_FAIL++ )); _group_tally fail; print "  FAIL $label"; print "       must not contain: $needle"; print "       in:               $haystack"
  fi
}

assert_exit() {
  local expected=$1 label=$2; shift 2
  "$@" >/dev/null 2>&1
  assert_eq $? $expected "$label"
}

skip() {
  (( ASSERT_SKIP++ )); _group_tally skip; print "  skip $1 ($2)"
}

summary() {
  print ""
  if (( ${#GROUP_PASS} )); then
    print -r -- "-- per-group --"
    local g
    for g in ${(ok)GROUP_PASS}; do
      print -r -- "  $g: pass=${GROUP_PASS[$g]} fail=${GROUP_FAIL[$g]} skip=${GROUP_SKIP[$g]}"
    done
    print ""
  fi
  print "pass=$ASSERT_PASS fail=$ASSERT_FAIL skip=$ASSERT_SKIP"
  (( ASSERT_FAIL == 0 ))
}
