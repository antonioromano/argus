#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$SCRIPT_DIR"

echo "Setting up Remote Orchestrator..."
echo ""

# --- OS detection ---
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Darwin)
    ;;
  Linux)
    # WSL is supported but untested
    if grep -qi microsoft /proc/version 2>/dev/null; then
      echo "Warning: WSL detected. Remote Orchestrator is untested on WSL."
      echo ""
    fi
    ;;
  *)
    echo "Error: Unsupported operating system: $OS" >&2
    echo "Remote Orchestrator supports macOS and Linux." >&2
    echo "Windows users: please use WSL (Windows Subsystem for Linux)." >&2
    exit 1
    ;;
esac

# --- [1/5] Check Node.js and npm ---
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is not installed." >&2
  echo "Please install Node.js 18+ from https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js 18+ required (found $(node -v))." >&2
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "Error: npm is not installed." >&2
  if [ "$OS" = "Linux" ]; then
    echo "  Debian/Ubuntu: sudo apt install npm" >&2
    echo "  Fedora/RHEL:   sudo dnf install npm" >&2
  fi
  exit 1
fi

echo "[1/5] Node.js $(node -v) detected"

# --- [2/5] Check system dependencies ---
echo "[2/5] Checking system dependencies..."

MISSING_DEPS=()

if ! command -v git &>/dev/null; then
  MISSING_DEPS+=("git")
fi

if ! command -v curl &>/dev/null; then
  MISSING_DEPS+=("curl")
fi

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
  echo "Error: Missing required dependencies: ${MISSING_DEPS[*]}" >&2
  if [ "$OS" = "Darwin" ]; then
    echo "  Install via Homebrew: brew install ${MISSING_DEPS[*]}" >&2
    echo "  Or install Xcode Command Line Tools: xcode-select --install" >&2
  else
    echo "  Debian/Ubuntu: sudo apt install ${MISSING_DEPS[*]}" >&2
    echo "  Fedora/RHEL:   sudo dnf install ${MISSING_DEPS[*]}" >&2
  fi
  exit 1
fi

# On Linux, node-pty compiles from source — check for build tools
if [ "$OS" = "Linux" ]; then
  MISSING_BUILD=()
  command -v python3 &>/dev/null || MISSING_BUILD+=("python3")
  command -v make    &>/dev/null || MISSING_BUILD+=("make")
  command -v g++     &>/dev/null || MISSING_BUILD+=("g++")

  if [ ${#MISSING_BUILD[@]} -gt 0 ]; then
    echo "Error: node-pty requires native compilation on Linux." >&2
    echo "Missing build tools: ${MISSING_BUILD[*]}" >&2
    echo "  Debian/Ubuntu: sudo apt install build-essential python3" >&2
    echo "  Fedora/RHEL:   sudo dnf groupinstall 'Development Tools' && sudo dnf install python3" >&2
    exit 1
  fi
fi

echo "  git, curl — OK"
[ "$OS" = "Linux" ] && echo "  build tools (python3, make, g++) — OK"

# --- [3/5] Install dependencies ---
echo "[3/5] Installing dependencies..."
cd "$PROJECT_ROOT"
npm install

# --- [4/5] Detect AI CLIs ---
echo "[4/5] Detecting AI CLI tools..."
DETECTED_CLIS=()
command -v claude &>/dev/null && DETECTED_CLIS+=("Claude (claude)")
command -v gemini &>/dev/null && DETECTED_CLIS+=("Gemini CLI (gemini)")
command -v codex  &>/dev/null && DETECTED_CLIS+=("Codex (codex)")

if [ ${#DETECTED_CLIS[@]} -gt 0 ]; then
  echo "  Detected: ${DETECTED_CLIS[*]}"
else
  echo ""
  echo "Warning: No AI CLI detected. At least one is required to use Remote Orchestrator." >&2
  echo "  Install Claude Code: npm install -g @anthropic-ai/claude-code" >&2
  echo "  Install Gemini CLI:  npm install -g @google/gemini-cli" >&2
  echo "  Install Codex:       npm install -g @openai/codex" >&2
  echo ""
fi

# --- [5/5] Install swarm command ---
echo "[5/5] Installing 'swarm' command..."
chmod +x "$PROJECT_ROOT/bin/swarm.sh"

# Pick an install directory in PATH (prefer ~/.local/bin on Linux)
INSTALL_DIR=""
if [ -d "$HOME/.local/bin" ] && [[ ":$PATH:" == *":$HOME/.local/bin:"* ]]; then
  INSTALL_DIR="$HOME/.local/bin"
elif [[ ":$PATH:" == *":/usr/local/bin:"* ]]; then
  INSTALL_DIR="/usr/local/bin"
elif [ "$OS" = "Linux" ]; then
  # Create ~/.local/bin and advise adding it to PATH
  mkdir -p "$HOME/.local/bin"
  INSTALL_DIR="$HOME/.local/bin"
  echo "  Note: $HOME/.local/bin created. Add it to PATH if not already set:"
  echo "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
else
  INSTALL_DIR="/usr/local/bin"
fi

SYMLINK_TARGET="$INSTALL_DIR/swarm"
SWARM_SOURCE="$PROJECT_ROOT/bin/swarm.sh"

# Remove existing symlink if it points elsewhere
if [ -L "$SYMLINK_TARGET" ]; then
  EXISTING_TARGET="$(readlink "$SYMLINK_TARGET")"
  if [ "$EXISTING_TARGET" != "$SWARM_SOURCE" ]; then
    echo "  Updating existing swarm symlink..."
    rm "$SYMLINK_TARGET" 2>/dev/null || sudo rm "$SYMLINK_TARGET"
  else
    echo "  Symlink already correct at $SYMLINK_TARGET"
  fi
fi

if [ ! -e "$SYMLINK_TARGET" ]; then
  if [ -w "$(dirname "$SYMLINK_TARGET")" ]; then
    ln -s "$SWARM_SOURCE" "$SYMLINK_TARGET"
  else
    echo "  Need permission to write to $(dirname "$SYMLINK_TARGET")"
    sudo ln -s "$SWARM_SOURCE" "$SYMLINK_TARGET"
  fi
fi

echo ""
echo "Setup complete! ($OS $ARCH)"
echo ""
echo "Usage:"
echo "  swarm             Show service status"
echo "  swarm start       Start the dashboard in the background"
echo "  swarm stop        Stop the running service"
echo "  swarm logs        Tail the log output"
echo "  swarm attach      Attach to the live session (screen/tmux)"
echo ""
echo "The dashboard will open in your default browser on start."
echo ""
