#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() {
  printf '\n==> %s\n' "$*"
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "git is required"
command -v bun >/dev/null 2>&1 || fail "bun is required"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ra-release.XXXXXX")"
ENV_EXISTED=0
[[ -e "$ROOT/anubis/.env" ]] && ENV_EXISTED=1

cleanup() {
  rm -rf "$TMP_ROOT"
  if [[ "$ENV_EXISTED" -eq 0 ]]; then
    rm -f "$ROOT/anubis/.env"
  fi
}
trap cleanup EXIT INT TERM

say "Checking tracked repository hygiene"
BAD_TRACKED=""
while IFS= read -r path; do
  case "$path" in
    */node_modules/*|node_modules/*|*/.DS_Store|.DS_Store|*/__pycache__/*|__pycache__/*|*.pyc|*.pyo|*.log|*.tsbuildinfo|dist/*|*/dist/*|build/*|*/build/*|coverage/*|*/coverage/*|tmp/*|*/tmp/*)
      BAD_TRACKED+="$path"$'\n'
      ;;
    .env|*/.env|.env.*|*/.env.*)
      case "$path" in
        .env.example|*/.env.example) ;;
        *) BAD_TRACKED+="$path"$'\n' ;;
      esac
      ;;
  esac
done < <(git ls-files)

if [[ -n "$BAD_TRACKED" ]]; then
  printf '%s' "$BAD_TRACKED" >&2
  fail "tracked generated/secret-like files found; remove or explicitly revise the release policy"
fi

say "Installing locked Bun dependencies"
(
  cd anubis
  bun install --frozen-lockfile
)

say "Running offline unit tests"
(
  cd anubis
  bun test \
    tests/tui.test.ts \
    tests/last-run.test.ts \
    tests/history.test.ts \
    tests/hello-guard.test.ts \
    tests/ollama-routing.test.ts \
    tests/cost.test.ts \
    tests/config.test.ts \
    ../ra/tests/runtime.test.ts \
    ../ra/tests/benchmark-artifacts.test.ts \
    ../ra/tests/run-command.test.ts \
    ../ra/tests/session.test.ts \
    ../ra/tests/permission.test.ts \
    ../ra/tests/custom-commands.test.ts \
    ../ra/tests/subagents.test.ts \
    ../ra/tests/checkpoint.test.ts \
    ../ra/tests/symbols.test.ts \
    ../ra/tests/mcp.test.ts \
    ../ra/tests/daemon.test.ts \
    ../ra/tests/diagnostics.test.ts \
    ../ra/tests/airgap.test.ts \
    ../ra/tests/selfheal.test.ts \
    ../ra/tests/diff.test.ts \
    ../ra/tests/search.test.ts \
    ../ra/tests/replay.test.ts \
    ../ra/tests/swarm.test.ts \
    ../ra/tests/ide.test.ts \
    ../ra/tests/eval.test.ts \\
    ../ra/tests/tui.test.ts \\
    ../ra/tests/tui-upgrade.test.ts
)

say "Smoke-testing the source CLI"
bun ra/src/cli.ts --version >/dev/null
bun ra/src/cli.ts help >/dev/null

say "Compiling the real RA CLI entrypoint"
bun build --compile ra/src/cli.ts --outfile "$TMP_ROOT/ra-compiled"
[[ -x "$TMP_ROOT/ra-compiled" ]] || fail "compiled RA executable was not created"

say "Smoke-testing compiled executable"
"$TMP_ROOT/ra-compiled" --version >/dev/null
"$TMP_ROOT/ra-compiled" help >/dev/null

say "Smoke-testing install launcher in an isolated HOME/bin"
mkdir -p "$TMP_ROOT/home" "$TMP_ROOT/bin"
HOME="$TMP_ROOT/home" RA_INSTALL_DIR="$TMP_ROOT/bin" ./install >/dev/null
[[ -x "$TMP_ROOT/bin/ra" ]] || fail "installer did not create an executable ra launcher"
HOME="$TMP_ROOT/home" "$TMP_ROOT/bin/ra" --version >/dev/null
HOME="$TMP_ROOT/home" "$TMP_ROOT/bin/ra" help >/dev/null

# The installer may create an ignored anubis/.env from .env.example. Remove only
# the file created by this verification run; never touch a developer's preexisting one.
if [[ "$ENV_EXISTED" -eq 0 ]]; then
  rm -f "$ROOT/anubis/.env"
fi

say "Checking that verification did not modify tracked source"
if ! git diff --quiet --ignore-submodules --; then
  git diff --stat >&2
  fail "release verification modified tracked files"
fi

# Ignored dependency/cache files are allowed locally. Any ordinary untracked file
# produced by the gate is a release-hygiene failure.
UNTRACKED="$(git ls-files --others --exclude-standard)"
if [[ -n "$UNTRACKED" ]]; then
  printf '%s\n' "$UNTRACKED" >&2
  fail "release verification left untracked files in the checkout"
fi

say "RA release verification passed"
printf 'Tests: PASS\nCompile: PASS\nCLI smoke: PASS\nInstall smoke: PASS\nRepository hygiene: PASS\n'
