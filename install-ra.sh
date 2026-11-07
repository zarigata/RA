#!/usr/bin/env bash
# RA one-liner remote installer — curl -fsSL https://raw.githubusercontent.com/zarigata/RA/main/install-ra.sh | bash
#
# Detects OS + package-manager flavor, installs prerequisites (git, bun),
# clones RA, runs the repo's ./install, and puts `ra` on PATH.
# Safe to re-run: existing clones are updated (git pull --ff-only).
set -euo pipefail

REPO_URL="https://github.com/zarigata/RA.git"
DEST_DIR="${RA_INSTALL_ROOT:-$HOME/RA}"
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31minstall-ra:\033[0m %s\n' "$*" >&2; exit 1; }

say "RA — Relic Agent one-liner install"

# ---- OS + flavor detection -----------------------------------------------
OS="$(uname -s)"
FLAVOR="unknown"
case "$OS" in
  Darwin) FLAVOR="darwin-brew" ;;
  Linux)
    . /etc/os-release 2>/dev/null || true
    for f in apt-get dnf yum pacman zypper apk; do
      command -v "$f" >/dev/null 2>&1 && { FLAVOR="$f"; break; }
    done
    [[ "$FLAVOR" == "unknown" ]] && [[ -n "${ID:-}" ]] && FLAVOR="$ID"
    ;;
  *) die "unsupported OS: $OS (macOS and Linux only)" ;;
esac
say "detected: $OS ($FLAVOR)"

needs() { command -v "$1" >/dev/null 2>&1; }

# ---- prerequisites --------------------------------------------------------
SUDO=""
[[ "$OS" == "Linux" ]] && [[ $EUID -ne 0 ]] && SUDO="sudo"

if ! needs git; then
  say "installing git"
  case "$FLAVOR" in
    apt-get|dnf|yum|zypper) $SUDO "$FLAVOR" install -y git ;;
    pacman)                 $SUDO pacman -Sy --noconfirm git ;;
    apk)                    $SUDO apk add git ;;
    darwin-brew)            xcode-select --install 2>/dev/null || true; die "restart after Xcode CLT install, then re-run" ;;
    *)                      die "git missing and no known package manager — install git, then re-run" ;;
  esac
fi

if ! needs bun; then
  say "installing bun"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
  needs bun || die "bun installed but not on PATH — open a new shell and re-run"
fi

# ---- clone / update RA ----------------------------------------------------
if [[ -d "$DEST_DIR/.git" ]]; then
  say "updating existing clone at $DEST_DIR"
  git -C "$DEST_DIR" fetch -q origin main || die "git fetch failed (offline?)"
  git -C "$DEST_DIR" reset -q --hard origin/main
else
  say "cloning RA → $DEST_DIR"
  git clone -q --depth 1 "$REPO_URL" "$DEST_DIR"
fi

# ---- repo install (PATH links + .env) --------------------------------------
say "running ./install (non-interactive; configure endpoints later with: ra doctor)"
"$DEST_DIR/install" --non-interactive

# ---- PATH persistence ------------------------------------------------------
add_path() { # add_path <shell-file> <export-line>
  [[ -f "$1" ]] && ! grep -qs "$2" "$1" && printf '\n%s\n' "$2" >> "$1"
}
BIN_DIR="${RA_INSTALL_DIR:-$HOME/.local/bin}"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  say "adding $BIN_DIR to PATH"
  add_path "$HOME/.zshrc"  "export PATH=\"\$HOME/.local/bin:\$PATH\""
  add_path "$HOME/.bashrc" "export PATH=\"\$HOME/.local/bin:\$PATH\""
  export PATH="$BIN_DIR:$PATH"
fi
BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin"
if [[ ":$PATH:" != *":$BUN_BIN:"* ]]; then
  add_path "$HOME/.zshrc"  "export BUN_INSTALL=\"\$HOME/.bun\"; export PATH=\"\$BUN_INSTALL/bin:\$PATH\""
  add_path "$HOME/.bashrc" "export BUN_INSTALL=\"\$HOME/.bun\"; export PATH=\"\$BUN_INSTALL/bin:\$PATH\""
  export PATH="$BUN_BIN:$PATH"
fi

# ---- verify ----------------------------------------------------------------
"$BIN_DIR/ra" --version

say "done. Type \033[1mra\033[0m to start (new shell, or: source ~/.zshrc)"
say "next: ra doctor  → add OLLAMA_LAN_URL / OLLAMA_API_KEY in $DEST_DIR/anubis/.env"
