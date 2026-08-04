# Shared assertion helpers for the orphan-hygiene test scripts.
# Source this, run assertions, call `summary` last.
emulate -L zsh

typeset -g ASSERT_PASS=0 ASSERT_FAIL=0 ASSERT_SKIP=0

assert_eq() {
  local actual=$1 expected=$2 label=$3
  if [[ $actual == $expected ]]; then
    (( ASSERT_PASS++ )); print "  ok   $label"
  else
    (( ASSERT_FAIL++ )); print "  FAIL $label"; print "       expected: $expected"; print "       actual:   $actual"
  fi
}

assert_contains() {
  local haystack=$1 needle=$2 label=$3
  if [[ $haystack == *$needle* ]]; then
    (( ASSERT_PASS++ )); print "  ok   $label"
  else
    (( ASSERT_FAIL++ )); print "  FAIL $label"; print "       missing: $needle"; print "       in:      $haystack"
  fi
}

assert_not_contains() {
  local haystack=$1 needle=$2 label=$3
  if [[ $haystack != *$needle* ]]; then
    (( ASSERT_PASS++ )); print "  ok   $label"
  else
    (( ASSERT_FAIL++ )); print "  FAIL $label"; print "       must not contain: $needle"; print "       in:               $haystack"
  fi
}

assert_exit() {
  local expected=$1 label=$2; shift 2
  "$@" >/dev/null 2>&1
  assert_eq $? $expected "$label"
}

skip() {
  (( ASSERT_SKIP++ )); print "  skip $1 ($2)"
}

summary() {
  print ""
  print "pass=$ASSERT_PASS fail=$ASSERT_FAIL skip=$ASSERT_SKIP"
  (( ASSERT_FAIL == 0 ))
}
