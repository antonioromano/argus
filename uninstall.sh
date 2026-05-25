#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$SCRIPT_DIR"
SWARM_SOURCE="$PROJECT_ROOT/bin/swarm.sh"

echo "Uninstalling Remote Orchestrator..."
echo ""

# --- Stop swarm if running ---
if [ -x "$PROJECT_ROOT/bin/swarm.sh" ]; then
  "$PROJECT_ROOT/bin/swarm.sh" stop 2>/dev/null || true
fi

# --- Clean up runtime files ---
rm -f "$PROJECT_ROOT/server/data/swarm.pid" \
      "$PROJECT_ROOT/server/data/swarm.session" \
      "$PROJECT_ROOT/server/data/swarm.log"

# --- Remove swarm symlink ---
REMOVED=false
for candidate in "$HOME/.local/bin/swarm" "/usr/local/bin/swarm"; do
  if [ -L "$candidate" ]; then
    LINK_TARGET="$(readlink "$candidate")"
    if [ "$LINK_TARGET" = "$SWARM_SOURCE" ]; then
      echo "Removing symlink: $candidate -> $LINK_TARGET"
      if [ -w "$(dirname "$candidate")" ]; then
        rm "$candidate"
      else
        sudo rm "$candidate"
      fi
      REMOVED=true
    else
      echo "Skipping $candidate (points to $LINK_TARGET, not this project)"
    fi
  fi
done

if [ "$REMOVED" = false ]; then
  echo "No swarm symlink found for this project."
fi

# --- Optionally remove node_modules ---
if [ -d "$PROJECT_ROOT/node_modules" ]; then
  echo ""
  read -r -p "Remove node_modules/? This frees disk space but requires 'npm install' to reinstall. [y/N] " answer
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    echo "Removing node_modules/..."
    rm -rf "$PROJECT_ROOT/node_modules"
    echo "Done."
  else
    echo "Keeping node_modules/."
  fi
fi

echo ""
echo "Uninstall complete. Project files remain intact."
echo "To reinstall, run: bash setup.sh"
echo ""
