#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Integration test harness for bin/argus
#
# Usage:  bash test/argus-integration.sh
#
# Requires: the project to have been built at least once (npm run build).
# Uses ports 5490-5492 and temp directories under /tmp/argus-test-*.
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
ARGUS="$PROJECT_ROOT/bin/argus"

# Test ports chosen to avoid collisions with dev (5401/5402) and prod (5400)
PORT_A=5490
PORT_B=5491
PORT_C=5492

PASS=0
FAIL=0
ERRORS=()

# Track all PIDs and temp dirs we create so we can clean up on exit
STARTED_PIDS=()
TEMP_DIRS=()

cleanup_all() {
  echo ""
  echo "Cleaning up test processes..."
  # Kill only processes WE started (tracked by PID)
  for pid in "${STARTED_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  # Also stop any instances managed by argus PID files in our temp dirs
  for dir in "${TEMP_DIRS[@]}"; do
    local pidfile="$dir/argus.pid"
    if [ -f "$pidfile" ]; then
      local pid
      pid=$(cat "$pidfile")
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
    fi
    rm -rf "$dir"
  done
}
trap cleanup_all EXIT

# --- Helpers ---------------------------------------------------------------

tmp_dir() {
  local dir
  dir=$(mktemp -d /tmp/argus-test-XXXXXX)
  TEMP_DIRS+=("$dir")
  echo "$dir"
}

start_instance() {
  local port="$1" dir="$2"
  ARGUS_PORT="$port" ARGUS_DATA_DIR="$dir" "$ARGUS" start >/dev/null 2>&1
  # Track the PID so cleanup_all can kill it even if cleanup_instance is skipped
  local pidfile="$dir/argus.pid"
  if [ -f "$pidfile" ]; then
    STARTED_PIDS+=("$(cat "$pidfile")")
  fi
}

cleanup_instance() {
  local port="$1" dir="$2"
  ARGUS_PORT="$port" ARGUS_DATA_DIR="$dir" "$ARGUS" stop >/dev/null 2>&1 || true
  rm -rf "$dir"
}

# Capture stdout+stderr and exit code from a command
run() {
  local output
  local exit_code=0
  output=$("$@" 2>&1) || exit_code=$?
  echo "$output"
  return $exit_code
}

assert_exit() {
  local expected="$1" actual="$2" test_name="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
    echo "  PASS: $test_name"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("$test_name (expected exit $expected, got $actual)")
    echo "  FAIL: $test_name (expected exit $expected, got $actual)"
  fi
}

assert_contains() {
  local output="$1" pattern="$2" test_name="$3"
  if echo "$output" | grep -qi "$pattern"; then
    PASS=$((PASS + 1))
    echo "  PASS: $test_name"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("$test_name (output did not contain '$pattern')")
    echo "  FAIL: $test_name (output did not contain '$pattern')"
  fi
}

assert_not_contains() {
  local output="$1" pattern="$2" test_name="$3"
  if echo "$output" | grep -qi "$pattern"; then
    FAIL=$((FAIL + 1))
    ERRORS+=("$test_name (output unexpectedly contained '$pattern')")
    echo "  FAIL: $test_name (output unexpectedly contained '$pattern')"
  else
    PASS=$((PASS + 1))
    echo "  PASS: $test_name"
  fi
}

assert_url_ok() {
  local url="$1" test_name="$2"
  if curl -s --max-time 3 "$url" >/dev/null 2>&1; then
    PASS=$((PASS + 1))
    echo "  PASS: $test_name"
  else
    FAIL=$((FAIL + 1))
    ERRORS+=("$test_name (URL $url not reachable)")
    echo "  FAIL: $test_name (URL $url not reachable)"
  fi
}

assert_url_fail() {
  local url="$1" test_name="$2"
  if curl -s --max-time 2 "$url" >/dev/null 2>&1; then
    FAIL=$((FAIL + 1))
    ERRORS+=("$test_name (URL $url should not be reachable)")
    echo "  FAIL: $test_name (URL $url should not be reachable)"
  else
    PASS=$((PASS + 1))
    echo "  PASS: $test_name"
  fi
}

# --- Preflight -------------------------------------------------------------

echo "Argus integration tests"
echo "======================="
echo ""

# Ensure test ports are free
for test_port in $PORT_A $PORT_B $PORT_C; do
  if curl -s --max-time 1 "http://localhost:$test_port/api/health" >/dev/null 2>&1; then
    echo "Error: Port $test_port is already in use. Cannot run tests." >&2
    echo "Kill the process on that port or choose different test ports." >&2
    exit 1
  fi
done

# Ensure build exists
if [ ! -f "$PROJECT_ROOT/server/dist/index.js" ]; then
  echo "Building project first..."
  (cd "$PROJECT_ROOT" && npm run build >/dev/null 2>&1)
fi

# --- Tests -----------------------------------------------------------------

echo "1. Help and usage"
  out=$(run "$ARGUS" 2>&1); rc=$?
  assert_exit 0 "$rc" "bare argus exits 0"
  assert_contains "$out" "Usage:" "bare argus prints usage"
  assert_contains "$out" "ARGUS_PORT" "bare argus documents env vars"

  out=$(run "$ARGUS" help 2>&1); rc=$?
  assert_exit 0 "$rc" "argus help exits 0"

  out=$(run "$ARGUS" --help 2>&1); rc=$?
  assert_exit 0 "$rc" "argus --help exits 0"

  out=$(run "$ARGUS" -h 2>&1); rc=$?
  assert_exit 0 "$rc" "argus -h exits 0"

  "$ARGUS" bogus >/dev/null 2>&1 && rc=0 || rc=$?
  assert_exit 1 "$rc" "unknown command exits 1"
echo ""

echo "2. Port validation"
  ARGUS_PORT=banana "$ARGUS" status >/dev/null 2>&1 && rc=0 || rc=$?
  assert_exit 1 "$rc" "rejects non-numeric port"

  ARGUS_PORT=0 "$ARGUS" status >/dev/null 2>&1 && rc=0 || rc=$?
  assert_exit 1 "$rc" "rejects port 0"

  ARGUS_PORT=70000 "$ARGUS" status >/dev/null 2>&1 && rc=0 || rc=$?
  assert_exit 1 "$rc" "rejects port > 65535"

  ARGUS_PORT=-1 "$ARGUS" status >/dev/null 2>&1 && rc=0 || rc=$?
  assert_exit 1 "$rc" "rejects negative port"
echo ""

echo "3. Start, status, stop lifecycle"
  dir=$(tmp_dir)
  out=$(ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir" run "$ARGUS" start 2>&1); rc=$?
  assert_exit 0 "$rc" "start exits 0"
  assert_contains "$out" "Argus started" "start reports success"
  assert_contains "$out" "(ARGUS_PORT)" "start shows port source"
  assert_contains "$out" "(ARGUS_DATA_DIR)" "start shows data dir source"
  assert_url_ok "http://localhost:$PORT_A/api/health" "server responds on configured port"

  out=$(ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir" run "$ARGUS" status 2>&1); rc=$?
  assert_exit 0 "$rc" "status exits 0 when running"
  assert_contains "$out" "is running" "status reports running"
  assert_contains "$out" "Dashboard:" "status shows dashboard URL"

  out=$(ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir" run "$ARGUS" stop 2>&1); rc=$?
  assert_exit 0 "$rc" "stop exits 0"
  assert_contains "$out" "Argus stopped" "stop reports stopped"
  assert_url_fail "http://localhost:$PORT_A/api/health" "server no longer responds after stop"

  out=$(ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir" run "$ARGUS" status 2>&1); rc=$?
  assert_exit 0 "$rc" "status exits 0 when stopped"
  assert_contains "$out" "not running" "status reports not running"
  rm -rf "$dir"
echo ""

echo "4. Config source labels"
  dir=$(tmp_dir)
  start_instance $PORT_C "$dir"
  out=$(ARGUS_PORT=$PORT_C ARGUS_DATA_DIR="$dir" run "$ARGUS" status 2>&1)
  assert_contains "$out" "(ARGUS_PORT)" "custom port shows (ARGUS_PORT)"
  assert_contains "$out" "(ARGUS_DATA_DIR)" "custom data dir shows (ARGUS_DATA_DIR)"
  cleanup_instance $PORT_C "$dir"
echo ""

echo "5. Double start"
  dir=$(tmp_dir)
  start_instance $PORT_A "$dir"
  out=$(ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir" run "$ARGUS" start 2>&1); rc=$?
  assert_exit 0 "$rc" "double start exits 0"
  assert_contains "$out" "already running" "double start reports already running"
  cleanup_instance $PORT_A "$dir"
echo ""

echo "6. Stop when not running"
  dir=$(tmp_dir)
  out=$(ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir" run "$ARGUS" stop 2>&1); rc=$?
  assert_exit 0 "$rc" "stop when not running exits 0"
  assert_contains "$out" "not running" "stop when not running reports correctly"
  rm -rf "$dir"
echo ""

echo "7. Stale PID file"
  dir=$(tmp_dir)
  echo "99999" > "$dir/argus.pid"
  out=$(ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir" run "$ARGUS" status 2>&1)
  assert_contains "$out" "not running" "stale PID detected as not running"
  [ ! -f "$dir/argus.pid" ] && rc=0 || rc=1
  assert_exit 0 "$rc" "stale PID file cleaned up"

  out=$(ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir" run "$ARGUS" start 2>&1); rc=$?
  assert_exit 0 "$rc" "start after stale PID works"
  cleanup_instance $PORT_A "$dir"
echo ""

echo "8. Port conflict"
  dir_a=$(tmp_dir)
  dir_b=$(tmp_dir)
  start_instance $PORT_A "$dir_a"

  # Try to start another instance on the same port
  ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir_b" "$ARGUS" start >/dev/null 2>&1 && rc=0 || rc=$?
  assert_exit 1 "$rc" "start on occupied port exits 1"

  # Foreground run should also detect
  ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir_b" "$ARGUS" run >/dev/null 2>&1 && rc=0 || rc=$?
  assert_exit 1 "$rc" "run on occupied port exits 1"

  cleanup_instance $PORT_A "$dir_a"
  rm -rf "$dir_b"
echo ""

echo "9. Concurrent instances"
  dir_a=$(tmp_dir)
  dir_b=$(tmp_dir)
  start_instance $PORT_A "$dir_a"
  start_instance $PORT_B "$dir_b"

  assert_url_ok "http://localhost:$PORT_A/api/health" "instance A responds"
  assert_url_ok "http://localhost:$PORT_B/api/health" "instance B responds"

  cleanup_instance $PORT_A "$dir_a"
  cleanup_instance $PORT_B "$dir_b"

  assert_url_fail "http://localhost:$PORT_A/api/health" "instance A stopped"
  assert_url_fail "http://localhost:$PORT_B/api/health" "instance B stopped"
echo ""

echo "10. Spaces in data directory path"
  dir="/tmp/argus test spaces $(date +%s)"
  out=$(ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir" run "$ARGUS" start 2>&1); rc=$?
  assert_exit 0 "$rc" "start with spaces in path exits 0"
  assert_url_ok "http://localhost:$PORT_A/api/health" "server works with spaces in data dir"
  [ -f "$dir/argus.pid" ] && rc=0 || rc=1
  assert_exit 0 "$rc" "PID file created in dir with spaces"
  cleanup_instance $PORT_A "$dir"
echo ""

echo "11. Non-existent nested data directory"
  dir="/tmp/argus-test-nested-$(date +%s)/a/b/c"
  out=$(ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir" run "$ARGUS" start 2>&1); rc=$?
  assert_exit 0 "$rc" "start creates nested dirs"
  [ -d "$dir" ] && rc=0 || rc=1
  assert_exit 0 "$rc" "nested directory was created"
  cleanup_instance $PORT_A "$dir"
  rm -rf "$(echo "$dir" | cut -d/ -f1-4)"
echo ""

echo "12. Missing node_modules"
  mv "$PROJECT_ROOT/node_modules" "$PROJECT_ROOT/node_modules_test_bak"
  "$ARGUS" start >/dev/null 2>&1 && rc=0 || rc=$?
  assert_exit 1 "$rc" "start fails without node_modules"
  mv "$PROJECT_ROOT/node_modules_test_bak" "$PROJECT_ROOT/node_modules"
echo ""

echo "13. Auto-build when dist missing"
  dir=$(tmp_dir)
  mv "$PROJECT_ROOT/server/dist" "$PROJECT_ROOT/server/dist_test_bak"
  out=$(ARGUS_PORT=$PORT_A ARGUS_DATA_DIR="$dir" run "$ARGUS" start 2>&1); rc=$?
  assert_exit 0 "$rc" "start auto-builds when dist missing"
  assert_contains "$out" "Running npm run build" "reports auto-build"
  assert_url_ok "http://localhost:$PORT_A/api/health" "server works after auto-build"
  cleanup_instance $PORT_A "$dir"
  # Restore original dist (the auto-build already recreated it, but clean up backup)
  rm -rf "$PROJECT_ROOT/server/dist_test_bak"
echo ""

echo "14. Update with bad tags"
  "$ARGUS" update v99.99.99 >/dev/null 2>&1 && rc=0 || rc=$?
  assert_exit 1 "$rc" "update non-existent tag exits 1"

  "$ARGUS" update not-a-tag >/dev/null 2>&1 && rc=0 || rc=$?
  assert_exit 1 "$rc" "update invalid tag exits 1"
echo ""

echo "15. Setup and remove"
  "$ARGUS" setup >/dev/null 2>&1
  out=$(run "$ARGUS" setup 2>&1)
  assert_contains "$out" "already correct" "setup is idempotent"

  out=$(run "$ARGUS" remove 2>&1)
  assert_contains "$out" "Removing symlink\|No argus symlink" "remove reports action"
  assert_contains "$out" "rm -rf" "remove shows cleanup instructions"

  # Re-setup for continued use
  "$ARGUS" setup >/dev/null 2>&1
echo ""

echo "16. Logs"
  dir=$(tmp_dir)
  start_instance $PORT_A "$dir"
  [ -f "$dir/argus.log" ] && rc=0 || rc=1
  assert_exit 0 "$rc" "log file created on argus start"
  cleanup_instance $PORT_A "$dir"
echo ""

# --- Summary ---------------------------------------------------------------

echo ""
echo "======================="
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo ""
  echo "Failures:"
  for err in "${ERRORS[@]}"; do
    echo "  - $err"
  done
  exit 1
fi
echo "All tests passed."
