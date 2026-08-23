# BUILD/09 — INSTALLER

**Phase:** 09
**Objective:** One-liner installer for Anubis on macOS, Linux, and Windows (WSL2). Single binary, near-zero idle CPU/GPU. Reuses opencode's install approach.
**Gate:** fresh-VM curl install passes on all 3 OS; `anubis --version` works; idle CPU < 1%.

---

## 1. Install targets

| OS | Method | Notes |
|---|---|---|
| macOS | `curl -fsSL https://anubis.dev/install \| bash` | arm64 + x64 |
| Linux | same | x64, arm64 |
| Windows | `curl -fsSL ... \| bash` (WSL2) | native best-effort |

---

## 2. Installer script

Create `install` at repo root (mirrors opencode's `install` script):

```bash
#!/usr/bin/env bash
set -euo pipefail

# Anubis installer — one-liner, single binary, low idle footprint.
# Usage: curl -fsSL https://anubis.dev/install | bash

REPO="anubis/anubis"                 # GitHub repo
VERSION="${ANUBIS_VERSION:-latest}"
INSTALL_DIR="${ANUBIS_INSTALL_DIR:-$HOME/.anubis/bin}"

# 1. Detect OS/arch
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *)      echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac
case "$ARCH" in
  x86_64|amd64) ARCH="x86_64" ;;
  arm64|aarch64) ARCH="aarch64" ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

# 2. Resolve version
if [ "$VERSION" = "latest" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)"
fi

# 3. Download binary
URL="https://github.com/$REPO/releases/download/$VERSION/anubis-$OS-$ARCH"
echo "Downloading $URL"
mkdir -p "$INSTALL_DIR"
curl -fsSL "$URL" -o "$INSTALL_DIR/anubis"
chmod +x "$INSTALL_DIR/anubis"

# 4. Add to PATH
case "$SHELL" in
  *zsh)  PROFILE="$HOME/.zshrc" ;;
  *bash) PROFILE="$HOME/.bashrc" ;;
  *)     PROFILE="$HOME/.profile" ;;
esac
if ! grep -q "$INSTALL_DIR" "$PROFILE" 2>/dev/null; then
  echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$PROFILE"
  echo "Added $INSTALL_DIR to PATH in $PROFILE"
fi

# 5. Verify
"$INSTALL_DIR/anubis" --version
echo "Anubis installed. Restart your shell or run: $INSTALL_DIR/anubis"
```

### 2.1 Release binary naming

GitHub Actions must produce:
- `anubis-darwin-x86_64`
- `anubis-darwin-aarch64`
- `anubis-linux-x86_64`
- `anubis-linux-aarch64`
- `anubis-windows-x86_64.exe` (best-effort)

### 2.2 CI workflow

`.github/workflows/release.yml`:

```yaml
name: release
on:
  push:
    tags: ["v*"]
jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run build
      - name: Package binary
        run: |
          # bundle the CLI into a single binary named anubis-<os>-<arch>
      - uses: softprops/action-gh-release@v2
        with:
          files: dist/anubis-*
```

---

## 3. Low idle footprint

| Check | Target |
|---|---|
| Idle CPU | < 1% |
| Idle RAM | < 100 MB |
| GPU | 0 (Anubis never loads models; Ollama/LM Studio do) |
| Startup time | < 1s |

Anubis is a TUI over a local server. It does not host models. Local inference runs in Ollama/LM Studio/llama.cpp (user-managed, separate processes).

---

## 4. Definition of Done (gate)

```bash
# on a fresh VM (macOS, Linux, Windows/WSL2):
curl -fsSL https://anubis.dev/install | bash
anubis --version
anubis
# idle check:
top -l 1 | grep anubis   # CPU < 1%
```

**Gate PASSED** when:
- [ ] Installer runs on macOS, Linux, Windows/WSL2
- [ ] `anubis --version` works after install
- [ ] TUI boots
- [ ] Idle CPU < 1%, RAM < 100 MB, GPU 0
- [ ] PATH updated in the right profile

**Gate FAILED** → BUILD/11-BUGFIX.md.

---

## 5. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| 404 on download | wrong asset name | match CI asset names exactly |
| permission denied | chmod missing | `chmod +x` before run |
| PATH not updated | wrong profile | detect shell; append to correct file |
| unsupported OS | case miss | add OS/arch cases |
| binary won't run | missing libc | build static; document glibc requirement |

---

## 6. Handoff

Gate passed → **BUILD/10-TESTS.md**.

Log in `BUILD/LOG.md`:
```
## Phase 09 — PASSED
- Date: <date>
- OS tested: <list>
- Idle CPU: <value>
```
