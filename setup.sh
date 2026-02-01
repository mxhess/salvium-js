#!/usr/bin/env bash
#
# salvium-js build setup
#
# Detects platform, checks dependencies, provides install instructions,
# and builds all components when ready.
#
# Usage:
#   ./setup.sh              Build everything
#   ./setup.sh --check      Check dependencies only
#   ./setup.sh --js-only    JS library only (bun install)
#   ./setup.sh --no-miner   Build WASM components, skip native miner
#

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { printf "  ${GREEN}[OK]${NC}   %s\n" "$1"; }
miss() { printf "  ${RED}[MISS]${NC} %s\n" "$1"; }
warn() { printf "  ${YELLOW}[WARN]${NC} %s\n" "$1"; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }
header() { printf "\n${BOLD}%s${NC}\n" "$1"; }

# ── Parse args ──────────────────────────────────────────────────────────

CHECK_ONLY=false
JS_ONLY=false
NO_MINER=false

for arg in "$@"; do
  case "$arg" in
    --check)    CHECK_ONLY=true ;;
    --js-only)  JS_ONLY=true ;;
    --no-miner) NO_MINER=true ;;
    --help|-h)
      echo "Usage: ./setup.sh [--check] [--js-only] [--no-miner]"
      echo ""
      echo "  --check      Check dependencies only, don't build"
      echo "  --js-only    Only install JS dependencies (skip WASM and native builds)"
      echo "  --no-miner   Build WASM components but skip native miner"
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ── Detect platform ────────────────────────────────────────────────────

# Ensure Rust/Cargo bin dirs are on PATH
[ -d "$HOME/.cargo/bin" ] && export PATH="$HOME/.cargo/bin:$PATH"
[ -d "$HOME/.rustup/toolchains" ] && {
  for tc in "$HOME"/.rustup/toolchains/*/bin; do
    [ -d "$tc" ] && export PATH="$tc:$PATH"
  done
}

OS="$(uname -s)"
ARCH="$(uname -m)"
PKG_MGR=""

case "$OS" in
  Linux)
    if command -v apt-get &>/dev/null; then PKG_MGR="apt"
    elif command -v dnf &>/dev/null; then PKG_MGR="dnf"
    elif command -v pacman &>/dev/null; then PKG_MGR="pacman"
    elif command -v apk &>/dev/null; then PKG_MGR="apk"
    elif command -v zypper &>/dev/null; then PKG_MGR="zypper"
    fi
    ;;
  Darwin) PKG_MGR="brew" ;;
  FreeBSD) PKG_MGR="pkg" ;;
esac

header "salvium-js build setup"
echo ""
info "Platform: $OS $ARCH"
[ -n "$PKG_MGR" ] && info "Package manager: $PKG_MGR"
echo ""

# ── Dependency checks ──────────────────────────────────────────────────

MISSING=()
INSTALL_CMDS=()

check_cmd() {
  local name="$1"
  local cmd="$2"
  local install_hint="$3"
  if command -v "$cmd" &>/dev/null; then
    local ver
    ver=$("$cmd" --version 2>/dev/null | head -1 || echo "found")
    ok "$name ($ver)"
    return 0
  else
    miss "$name -- $install_hint"
    MISSING+=("$name")
    INSTALL_CMDS+=("$install_hint")
    return 1
  fi
}

# ── Bun (required) ─────────────────────────────────────────────────────

header "Required: Runtime"

check_cmd "bun" "bun" "curl -fsSL https://bun.sh/install | bash" || true

if ! command -v bun &>/dev/null; then
  echo ""
  printf "${RED}Bun is required. Install it first:${NC}\n"
  echo "  curl -fsSL https://bun.sh/install | bash"
  echo ""
  if $CHECK_ONLY; then
    exit 1
  fi
  echo "Cannot continue without bun."
  exit 1
fi

# ── Rust toolchain (needed for WASM crypto + miner) ────────────────────

if ! $JS_ONLY; then
  header "Required: Rust toolchain"

  check_cmd "rustc" "rustc" "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" || true
  check_cmd "cargo" "cargo" "(installed with rustup)" || true

  # Check wasm32 target
  if command -v rustup &>/dev/null; then
    if rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown; then
      ok "wasm32-unknown-unknown target"
    else
      miss "wasm32-unknown-unknown target -- rustup target add wasm32-unknown-unknown"
      MISSING+=("wasm32-target")
      INSTALL_CMDS+=("rustup target add wasm32-unknown-unknown")
    fi
  fi

  check_cmd "wasm-pack" "wasm-pack" "cargo install wasm-pack" || true
fi

# ── C/C++ toolchain (needed for native miner) ──────────────────────────

if ! $JS_ONLY && ! $NO_MINER; then
  header "Required: C/C++ toolchain (for native miner)"

  HAS_CXX=false
  if command -v g++ &>/dev/null; then
    ok "g++ ($(g++ --version | head -1))"
    HAS_CXX=true
  elif command -v clang++ &>/dev/null; then
    ok "clang++ ($(clang++ --version | head -1))"
    HAS_CXX=true
  elif command -v c++ &>/dev/null; then
    ok "c++ compiler found"
    HAS_CXX=true
  fi

  if ! $HAS_CXX; then
    case "$PKG_MGR" in
      apt)    hint="sudo apt install build-essential" ;;
      dnf)    hint="sudo dnf groupinstall 'Development Tools'" ;;
      pacman) hint="sudo pacman -S base-devel" ;;
      brew)   hint="xcode-select --install" ;;
      pkg)    hint="sudo pkg install gcc" ;;
      *)      hint="install gcc or clang" ;;
    esac
    miss "C++ compiler -- $hint"
    MISSING+=("c++")
    INSTALL_CMDS+=("$hint")
  fi

  # cmake
  case "$PKG_MGR" in
    apt)    cmake_hint="sudo apt install cmake" ;;
    dnf)    cmake_hint="sudo dnf install cmake" ;;
    pacman) cmake_hint="sudo pacman -S cmake" ;;
    brew)   cmake_hint="brew install cmake" ;;
    pkg)    cmake_hint="sudo pkg install cmake" ;;
    *)      cmake_hint="install cmake (https://cmake.org)" ;;
  esac
  check_cmd "cmake" "cmake" "$cmake_hint" || true

  # make
  if ! command -v make &>/dev/null && ! command -v ninja &>/dev/null; then
    case "$PKG_MGR" in
      apt)    hint="sudo apt install make" ;;
      dnf)    hint="sudo dnf install make" ;;
      brew)   hint="(included with xcode-select --install)" ;;
      *)      hint="install make or ninja" ;;
    esac
    miss "make/ninja -- $hint"
    MISSING+=("make")
    INSTALL_CMDS+=("$hint")
  else
    if command -v make &>/dev/null; then
      ok "make"
    else
      ok "ninja"
    fi
  fi
fi

# ── Summary ─────────────────────────────────────────────────────────────

echo ""
if [ ${#MISSING[@]} -gt 0 ]; then
  header "Missing dependencies (${#MISSING[@]}):"
  echo ""
  printf "  Install commands:\n"
  # Deduplicate
  printf '%s\n' "${INSTALL_CMDS[@]}" | sort -u | while read -r cmd; do
    printf "    ${YELLOW}%s${NC}\n" "$cmd"
  done
  echo ""
  if $CHECK_ONLY; then
    echo "Run the install commands above, then re-run ./setup.sh"
    exit 1
  fi
  echo "Some components may fail to build. Continuing with what's available..."
  echo ""
else
  printf "${GREEN}All dependencies satisfied.${NC}\n\n"
fi

if $CHECK_ONLY; then
  exit 0
fi

# ── Build ───────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

BUILT=()
FAILED=()

# 1. Install JS dependencies
header "Installing JS dependencies..."
if bun install; then
  BUILT+=("JS dependencies")
else
  FAILED+=("JS dependencies")
fi

if $JS_ONLY; then
  header "Build complete (JS only)"
  exit 0
fi

# 2. Build WASM crypto
if command -v wasm-pack &>/dev/null && command -v cargo &>/dev/null; then
  header "Building WASM crypto..."
  (
    cd crates/salvium-crypto
    RUSTFLAGS="-Ctarget-feature=+simd128" wasm-pack build --target web --out-dir ../../src/crypto/wasm
  ) && BUILT+=("WASM crypto") || FAILED+=("WASM crypto")
else
  warn "Skipping WASM crypto (missing wasm-pack or cargo)"
  FAILED+=("WASM crypto (skipped)")
fi

# 3. Build RandomX WASM
header "Building RandomX WASM..."
if bun run build:wasm; then
  BUILT+=("RandomX WASM")
else
  FAILED+=("RandomX WASM")
fi

# 4. Build native miner
if ! $NO_MINER; then
  if command -v cargo &>/dev/null && command -v cmake &>/dev/null; then
    header "Building native miner (this may take a few minutes on first build)..."
    (
      cd crates/salvium-miner
      cargo build --release
    ) && BUILT+=("Native miner") || FAILED+=("Native miner")
  else
    warn "Skipping native miner (missing cargo or cmake)"
    FAILED+=("Native miner (skipped)")
  fi
fi

# ── Results ─────────────────────────────────────────────────────────────

echo ""
header "Build Results"
echo ""

for item in "${BUILT[@]}"; do
  ok "$item"
done
for item in "${FAILED[@]}"; do
  miss "$item"
done

echo ""
if [ ${#BUILT[@]} -gt 0 ]; then
  header "Output locations:"
  [ -f src/crypto/wasm/salvium_crypto_bg.wasm ] && echo "  WASM crypto:  src/crypto/wasm/salvium_crypto_bg.wasm"
  [ -f build/randomx.wasm ]                     && echo "  RandomX WASM: build/randomx.wasm"
  MINER_BIN="crates/salvium-miner/target/release/salvium-miner"
  [ -f "$MINER_BIN" ]                           && echo "  Native miner: $MINER_BIN"
  echo ""
fi

if [ ${#FAILED[@]} -eq 0 ]; then
  printf "${GREEN}All components built successfully.${NC}\n"
  echo ""
  echo "Quick start:"
  echo "  bun test/run.js                    # Run tests"
  if [ -f "crates/salvium-miner/target/release/salvium-miner" ]; then
    echo "  ./crates/salvium-miner/target/release/salvium-miner --benchmark  # Benchmark miner"
  fi
  exit 0
else
  printf "${YELLOW}Some components failed. Check output above.${NC}\n"
  exit 1
fi
