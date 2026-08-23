#!/usr/bin/env bash
# RA full test entry — unit + E2E TUI full-dev task (must show RA branding)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Small/"local" = .251; BIG = Ollama Cloud via .env
export OLLAMA_LAN_URL="${OLLAMA_LAN_URL:-http://192.168.1.251:11434}"
export OLLAMA_LOCAL_URL="${OLLAMA_LOCAL_URL:-http://localhost:11434}"
export ANUBIS_HOME="$ROOT"
export RA_HOME="$(cd "$ROOT/.." && pwd)"
RA_BIN=(bun "$RA_HOME/ra/src/cli.ts")

echo "╔══════════════════════════════════════╗"
echo "║  RA — Relic Agent Test Suite         ║"
echo "╚══════════════════════════════════════╝"
echo "  OLLAMA_LAN_URL=$OLLAMA_LAN_URL  (small)"
echo "  OLLAMA_CLOUD=https://ollama.com/v1  (BIG)"
echo

bun -e "import { APP_NAME } from './src/tui.ts'; if (APP_NAME !== 'RA') process.exit(1); console.log('✓ APP_NAME=RA')"

echo "▶ ra version"
"${RA_BIN[@]}" version | tee /tmp/ra-version.txt
grep -qE "^RA 1\.0\.0-ra\." /tmp/ra-version.txt || { echo "FAIL: ra version missing RA branding"; cat /tmp/ra-version.txt; exit 1; }
grep -q "RA prefer small@251" /tmp/ra-version.txt || { echo "FAIL: ra version missing RA prefer"; cat /tmp/ra-version.txt; exit 1; }
echo "✓ ra version"

echo "▶ ra help"
"${RA_BIN[@]}" help | tee /tmp/ra-help.txt
grep -qE "^RA —|Relic Agent" /tmp/ra-help.txt || { echo "FAIL: ra help missing RA branding"; cat /tmp/ra-help.txt; exit 1; }
grep -q "ra demo" /tmp/ra-help.txt || { echo "FAIL: ra help missing demo"; exit 1; }
grep -q "192.168.1.251" /tmp/ra-help.txt || { echo "FAIL: ra help missing .251"; exit 1; }
grep -qE "qwen3\.8|gemma" /tmp/ra-help.txt || { echo "FAIL: ra help missing qwen/gemma"; exit 1; }
grep -q "selfcheck" /tmp/ra-help.txt || { echo "FAIL: ra help missing selfcheck"; exit 1; }
grep -q "which" /tmp/ra-help.txt || { echo "FAIL: ra help missing which"; exit 1; }
grep -qE "ra lane|  ra lane" /tmp/ra-help.txt || { echo "FAIL: ra help missing ra lane"; exit 1; }
grep -q "/quick" /tmp/ra-help.txt || { echo "FAIL: ra help missing TUI /quick"; exit 1; }
grep -qE "ra prefer|ra files|ra again" /tmp/ra-help.txt || { echo "FAIL: ra help missing prefer/files/again"; exit 1; }
echo "✓ ra help"

echo "▶ ra unknown command"
UNK_OUT="$(mktemp)"
set +e
"${RA_BIN[@]}" nosuchcmd 2>"$UNK_OUT" >/dev/null
UNK_RC=$?
set -e
[[ "$UNK_RC" -ne 0 ]] || { echo "FAIL: unknown command should exit non-zero"; exit 1; }
grep -qiE "unknown|RA" "$UNK_OUT" || { echo "FAIL: unknown command missing RA error"; cat "$UNK_OUT"; exit 1; }
grep -q "help" "$UNK_OUT" || { echo "FAIL: unknown command should hint ra help"; cat "$UNK_OUT"; exit 1; }
echo "✓ ra unknown command"

echo "▶ ra palette"
"${RA_BIN[@]}" palette | tee /tmp/ra-palette.txt
grep -q "RA palette" /tmp/ra-palette.txt || { echo "FAIL: ra palette missing header"; exit 1; }
grep -q "/quick" /tmp/ra-palette.txt || { echo "FAIL: ra palette missing /quick"; exit 1; }
grep -q "/again" /tmp/ra-palette.txt || { echo "FAIL: ra palette missing /again"; exit 1; }
grep -q "/prefer" /tmp/ra-palette.txt || { echo "FAIL: ra palette missing /prefer"; exit 1; }
grep -q "/verify" /tmp/ra-palette.txt || { echo "FAIL: ra palette missing /verify"; exit 1; }
PAL_DIR="$(mktemp -d /tmp/ra-pal-XXXX)"
PAL_TUI="$(mktemp)"
printf '/palette\n/exit\n' | "${RA_BIN[@]}" --project "$PAL_DIR" 2>&1 | tee "$PAL_TUI" >/dev/null
grep -q "RA palette" "$PAL_TUI" || { echo "FAIL: /palette missing RA palette"; cat "$PAL_TUI"; exit 1; }
grep -q "Welcome to RA" "$PAL_TUI" || { echo "FAIL: fresh TUI missing Welcome to RA"; cat "$PAL_TUI"; exit 1; }
grep -qE "qwen3\.8 @251|@251" "$PAL_TUI" || { echo "FAIL: TUI welcome missing @251 hint"; cat "$PAL_TUI"; exit 1; }
grep -q "/again" "$PAL_TUI" || { echo "FAIL: TUI welcome missing /again"; cat "$PAL_TUI"; exit 1; }
grep -q "/verify" "$PAL_TUI" || { echo "FAIL: TUI welcome missing /verify"; cat "$PAL_TUI"; exit 1; }
echo "✓ ra palette"

echo "▶ ra splash (RA TUI branding)"
"${RA_BIN[@]}" splash | tee /tmp/ra-splash.txt
grep -q "RA TUI" /tmp/ra-splash.txt || { echo "FAIL: ra splash missing RA TUI"; cat /tmp/ra-splash.txt; exit 1; }
grep -qE "v1\.0\.0-ra\." /tmp/ra-splash.txt || { echo "FAIL: ra splash missing version"; exit 1; }
grep -qE "Relic Agent|Mixture-of-Agents" /tmp/ra-splash.txt || { echo "FAIL: ra splash missing tagline"; exit 1; }
grep -q "RA prefer small@251" /tmp/ra-splash.txt || { echo "FAIL: ra splash missing RA prefer small@251"; cat /tmp/ra-splash.txt; exit 1; }
echo "✓ ra splash"

echo "▶ ra home"
"${RA_BIN[@]}" home | tee /tmp/ra-home-cmd.txt
grep -q "RA home" /tmp/ra-home-cmd.txt || { echo "FAIL: ra home missing header"; exit 1; }
grep -q "anubis:" /tmp/ra-home-cmd.txt || { echo "FAIL: ra home missing anubis path"; exit 1; }
grep -q "global:" /tmp/ra-home-cmd.txt || { echo "FAIL: ra home missing global ~/.ra"; exit 1; }
grep -q "RA prefer small@251" /tmp/ra-home-cmd.txt || { echo "FAIL: ra home missing RA prefer"; cat /tmp/ra-home-cmd.txt; exit 1; }
echo "✓ ra home (paths)"

echo "▶ bun test (anubis)"
bun test

echo "▶ bun test (ra runtime)"
bun test ../ra/tests/runtime.test.ts ../ra/tests/benchmark-artifacts.test.ts ../ra/tests/run-command.test.ts ../ra/tests/session.test.ts ../ra/tests/permission.test.ts ../ra/tests/custom-commands.test.ts ../ra/tests/subagents.test.ts ../ra/tests/checkpoint.test.ts ../ra/tests/symbols.test.ts ../ra/tests/mcp.test.ts ../ra/tests/daemon.test.ts ../ra/tests/diagnostics.test.ts ../ra/tests/airgap.test.ts ../ra/tests/selfheal.test.ts ../ra/tests/diff.test.ts

echo "▶ ra doctor"
"${RA_BIN[@]}" doctor | tee /tmp/ra-doctor.txt
grep -q "RA doctor" /tmp/ra-doctor.txt || { echo "FAIL: ra doctor missing RA doctor banner"; exit 1; }
grep -qE "v1\.0\.0-ra\." /tmp/ra-doctor.txt || { echo "FAIL: ra doctor missing version"; exit 1; }
grep -qE "qwen3\.8|251|Small Ollama|localhost" /tmp/ra-doctor.txt || { echo "FAIL: ra doctor missing .251/qwen path"; exit 1; }
grep -qE "Small Ollama \(@(251|local)" /tmp/ra-doctor.txt || { echo "FAIL: ra doctor missing @251|@local host tag"; cat /tmp/ra-doctor.txt; exit 1; }
grep -qE "RA prefer small@(251|local)" /tmp/ra-doctor.txt || { echo "FAIL: ra doctor missing RA prefer"; cat /tmp/ra-doctor.txt; exit 1; }
echo "✓ ra doctor"

echo "▶ gemma localhost fallback probe"
bun -e "
import { OllamaClient } from './src/ollama.ts';
const c = OllamaClient.fromLocal(process.env.OLLAMA_LOCAL_URL ?? 'http://localhost:11434');
const ok = await c.probe(2000);
const gemma = c.availableModels.filter(m => /gemma/i.test(m));
console.log(ok ? \`○ localhost fallback reachable (\${gemma.join(', ') || c.availableModels.length + ' models'})\` : '○ localhost gemma not running (optional)');
"

echo "▶ ra ping"
"${RA_BIN[@]}" ping | tee /tmp/ra-ping.txt
grep -q "RA ping" /tmp/ra-ping.txt || { echo "FAIL: ra ping missing header"; exit 1; }
grep -qE "✓ 251|✓ local" /tmp/ra-ping.txt || { echo "FAIL: ra ping — neither .251 nor localhost up"; exit 1; }
grep -qE "qwen3\.8|gemma" /tmp/ra-ping.txt || { echo "FAIL: ra ping missing qwen3.8/gemma notable models"; cat /tmp/ra-ping.txt; exit 1; }
grep -qE "RA prefer small@(251|local) → big@(cloud|down)" /tmp/ra-ping.txt || { echo "FAIL: ra ping missing RA prefer"; cat /tmp/ra-ping.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA prefer small@251" /tmp/ra-ping.txt || { echo "FAIL: ra ping should prefer small@251"; exit 1; }
fi
echo "✓ ra ping"

echo "▶ ra which"
"${RA_BIN[@]}" which | tee /tmp/ra-which.txt
grep -q "RA which" /tmp/ra-which.txt || { echo "FAIL: ra which missing header"; exit 1; }
grep -qE "small → @(251|local)" /tmp/ra-which.txt || { echo "FAIL: ra which missing small host"; cat /tmp/ra-which.txt; exit 1; }
grep -qE "RA prefer small@(251|local)" /tmp/ra-which.txt || { echo "FAIL: ra which missing RA prefer"; cat /tmp/ra-which.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "small → @251" /tmp/ra-which.txt || { echo "FAIL: ra which should prefer @251"; cat /tmp/ra-which.txt; exit 1; }
  grep -q "RA prefer small@251" /tmp/ra-which.txt || { echo "FAIL: ra which prefer not @251"; exit 1; }
  grep -qE "qwen3\.8" /tmp/ra-which.txt || { echo "FAIL: ra which missing qwen on @251"; exit 1; }
fi
WHICH_TUI="$(mktemp)"
printf '/which\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$WHICH_TUI" >/dev/null
grep -q "RA which" "$WHICH_TUI" || { echo "FAIL: /which missing RA which"; cat "$WHICH_TUI"; exit 1; }
echo "✓ ra which"

echo "▶ ra selfcheck"
"${RA_BIN[@]}" selfcheck | tee /tmp/ra-selfcheck.txt
grep -q "RA TUI" /tmp/ra-selfcheck.txt || { echo "FAIL: selfcheck missing RA TUI"; exit 1; }
grep -q "RA ping" /tmp/ra-selfcheck.txt || { echo "FAIL: selfcheck missing RA ping"; exit 1; }
grep -qE "RA prefer small@" /tmp/ra-selfcheck.txt || { echo "FAIL: selfcheck missing RA prefer"; cat /tmp/ra-selfcheck.txt; exit 1; }
grep -q "RA lanes" /tmp/ra-selfcheck.txt || { echo "FAIL: selfcheck missing RA lanes"; exit 1; }
grep -q "RA models" /tmp/ra-selfcheck.txt || { echo "FAIL: selfcheck missing RA models"; exit 1; }
grep -qE "✓ 251|✓ local" /tmp/ra-selfcheck.txt || { echo "FAIL: selfcheck no small host"; exit 1; }
grep -q "RA which" /tmp/ra-selfcheck.txt || { echo "FAIL: selfcheck missing RA which"; exit 1; }
grep -qE "qwen3\.8|gemma" /tmp/ra-selfcheck.txt || { echo "FAIL: selfcheck missing qwen/gemma"; exit 1; }
grep -q "RA selfcheck OK" /tmp/ra-selfcheck.txt || { echo "FAIL: selfcheck not OK"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "small @251" /tmp/ra-selfcheck.txt || { echo "FAIL: selfcheck should prefer small @251"; cat /tmp/ra-selfcheck.txt; exit 1; }
  grep -q "small → @251" /tmp/ra-selfcheck.txt || { echo "FAIL: selfcheck which should prefer @251"; exit 1; }
fi
SC_TUI="$(mktemp)"
printf '/selfcheck\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$SC_TUI" >/dev/null
grep -q "RA selfcheck OK" "$SC_TUI" || { echo "FAIL: /selfcheck missing OK"; cat "$SC_TUI"; exit 1; }
grep -qE "RA TUI|RA ping" "$SC_TUI" || { echo "FAIL: /selfcheck missing branding"; exit 1; }
grep -q "RA which" "$SC_TUI" || { echo "FAIL: /selfcheck missing RA which"; exit 1; }
echo "✓ ra selfcheck"

echo "▶ ra demo (RA TUI full-dev one-shot)"
DEMO_OUT="$(mktemp)"
set +e
"${RA_BIN[@]}" demo 2>&1 | tee "$DEMO_OUT"
DEMO_RC=${PIPESTATUS[0]}
set -e
[[ "$DEMO_RC" -eq 0 ]] || { echo "FAIL: ra demo exit $DEMO_RC"; exit "$DEMO_RC"; }
grep -q "RA TUI" "$DEMO_OUT" || { echo "FAIL: ra demo missing RA TUI"; exit 1; }
grep -qE "RA ✓ done|dev cycle complete" "$DEMO_OUT" || { echo "FAIL: ra demo missing done"; exit 1; }
grep -qE "qwen3\.8|gemma" "$DEMO_OUT" || { echo "FAIL: ra demo missing small model"; exit 1; }
grep -qE "@251|@local" "$DEMO_OUT" || { echo "FAIL: ra demo missing host tag"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "@251" "$DEMO_OUT" || { echo "FAIL: ra demo missing @251 while .251+qwen up"; exit 1; }
fi
grep -q "RA RESULT" "$DEMO_OUT" || { echo "FAIL: ra demo missing RA RESULT"; exit 1; }
if grep -qE "RA RESULT.*files=none" "$DEMO_OUT"; then echo "FAIL: ra demo files=none"; exit 1; fi
grep -q "RA demo verify" "$DEMO_OUT" || { echo "FAIL: ra demo missing verify"; exit 1; }
grep -qi hello "$DEMO_OUT" || { echo "FAIL: ra demo verify output missing hello"; exit 1; }
grep -qE "RA lane " "$DEMO_OUT" || { echo "FAIL: ra demo missing RA lane"; exit 1; }
grep -qE "RA RESULT.*intent=code" "$DEMO_OUT" || { echo "FAIL: ra demo missing intent=code"; grep "RA RESULT" "$DEMO_OUT"; exit 1; }
grep -q "RA intent code" "$DEMO_OUT" || { echo "FAIL: ra demo missing RA intent code"; exit 1; }
grep -qE "RA prefer small@(251|local) → big@cloud" "$DEMO_OUT" || { echo "FAIL: ra demo missing live RA prefer"; exit 1; }
grep -q "again: ra again --quick --verify" "$DEMO_OUT" || { echo "FAIL: ra demo missing again tip"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" "$DEMO_OUT" || { echo "FAIL: ra demo lane not @251"; exit 1; }
  grep -q "RA prefer small@251 → big@cloud" "$DEMO_OUT" || { echo "FAIL: ra demo prefer not @251"; exit 1; }
fi
echo "✓ ra demo"

echo "▶ ra init"
INIT_DIR="$(mktemp -d /tmp/ra-init-XXXX)"
(
  cd "$INIT_DIR"
  "${RA_BIN[@]}" init
)
test -f "$INIT_DIR/.ra/project.json"
grep -q "qwen3.8" "$INIT_DIR/.ra/project.json"
INIT_OUT="$(mktemp)"
(
  cd "$INIT_DIR"
  "${RA_BIN[@]}" init
) | tee "$INIT_OUT"
grep -q "RA init" "$INIT_OUT" || { echo "FAIL: ra init missing RA init banner"; cat "$INIT_OUT"; exit 1; }
grep -q "RA prefer small@251" "$INIT_OUT" || { echo "FAIL: ra init missing RA prefer"; cat "$INIT_OUT"; exit 1; }
echo "✓ ra init"

echo "▶ ra env"
ENV_OUT="$(mktemp)"
"${RA_BIN[@]}" env | tee "$ENV_OUT"
grep -q "RA env" "$ENV_OUT" || { echo "FAIL: ra env missing header"; exit 1; }
grep -q "192.168.1.251" "$ENV_OUT" || { echo "FAIL: ra env missing .251"; exit 1; }
grep -q "localhost" "$ENV_OUT" || { echo "FAIL: ra env missing localhost fallback"; exit 1; }
grep -q "RA prefer small@251" "$ENV_OUT" || { echo "FAIL: ra env missing RA prefer small@251"; cat "$ENV_OUT"; exit 1; }
# must not dump full API key
if grep -qE "OLLAMA_API_KEY=[a-f0-9]{20,}\." "$ENV_OUT"; then
  echo "FAIL: ra env leaked full API key"
  exit 1
fi
echo "✓ ra env"

echo "▶ ra models"
MODELS_CLI="$(mktemp)"
"${RA_BIN[@]}" models | tee "$MODELS_CLI"
grep -q "RA models" "$MODELS_CLI" || { echo "FAIL: ra models missing header"; exit 1; }
grep -qE "small @(251|local)" "$MODELS_CLI" || { echo "FAIL: ra models missing small @251|local"; cat "$MODELS_CLI"; exit 1; }
grep -qE "qwen3\.8|gemma" "$MODELS_CLI" || { echo "FAIL: ra models missing qwen/gemma"; cat "$MODELS_CLI"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "small @251" "$MODELS_CLI" || { echo "FAIL: .251+qwen up but ra models not small @251"; cat "$MODELS_CLI"; exit 1; }
  grep -q "RA prefer small@251" "$MODELS_CLI" || { echo "FAIL: ra models prefer not @251"; cat "$MODELS_CLI"; exit 1; }
fi
grep -qE "RA prefer small@(251|local|\?)" "$MODELS_CLI" || { echo "FAIL: ra models missing RA prefer"; cat "$MODELS_CLI"; exit 1; }
echo "✓ ra models"

echo "▶ ra lanes"
LANES_OUT="$(mktemp)"
"${RA_BIN[@]}" lanes | tee "$LANES_OUT"
grep -q "RA lanes" "$LANES_OUT" || { echo "FAIL: ra lanes missing header"; exit 1; }
grep -q "192.168.1.251" "$LANES_OUT" || { echo "FAIL: ra lanes missing .251"; exit 1; }
grep -qE "qwen3\.8" "$LANES_OUT" || { echo "FAIL: ra lanes missing qwen3.8"; exit 1; }
grep -qE "gemma" "$LANES_OUT" || { echo "FAIL: ra lanes missing gemma fallback"; exit 1; }
grep -qE "glm-5|@cloud" "$LANES_OUT" || { echo "FAIL: ra lanes missing BIG/cloud"; exit 1; }
grep -q "RA prefer small@251" "$LANES_OUT" || { echo "FAIL: ra lanes missing RA prefer"; cat "$LANES_OUT"; exit 1; }
LANES_TUI="$(mktemp)"
printf '/lanes\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$LANES_TUI" >/dev/null
grep -q "RA lanes" "$LANES_TUI" || { echo "FAIL: /lanes missing RA lanes"; cat "$LANES_TUI"; exit 1; }
grep -q "RA prefer small@251" "$LANES_TUI" || { echo "FAIL: /lanes missing RA prefer"; cat "$LANES_TUI"; exit 1; }
echo "✓ ra lanes"

echo "▶ ra roles"
ROLES_OUT="$(mktemp)"
"${RA_BIN[@]}" roles | tee "$ROLES_OUT"
grep -qE "RA|/roles" "$ROLES_OUT" || { echo "FAIL: ra roles missing RA branding"; exit 1; }
grep -qE "thoth.*qwen3\.8" "$ROLES_OUT" || { echo "FAIL: ra roles missing thoth→qwen3.8"; cat "$ROLES_OUT"; exit 1; }
grep -qE "ptah.*(glm-5|cloud)" "$ROLES_OUT" || { echo "FAIL: ra roles missing ptah→glm/cloud"; cat "$ROLES_OUT"; exit 1; }
grep -q "RA prefer small@251" "$ROLES_OUT" || { echo "FAIL: ra roles missing RA prefer"; cat "$ROLES_OUT"; exit 1; }
ROLES_TUI="$(mktemp)"
printf '/roles\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$ROLES_TUI" >/dev/null
grep -qE "thoth|qwen3\.8|RA" "$ROLES_TUI" || { echo "FAIL: /roles missing assignments"; cat "$ROLES_TUI"; exit 1; }
grep -q "RA prefer small@251" "$ROLES_TUI" || { echo "FAIL: /roles missing RA prefer"; cat "$ROLES_TUI"; exit 1; }
echo "✓ ra roles"

echo "▶ E2E: interactive TUI smoke (RA name + /help)"
TUI_OUT="$(mktemp)"
set +e
printf '/help\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$TUI_OUT"
TUI_RC=${PIPESTATUS[0]}
set -e
grep -q "RA" "$TUI_OUT" || { echo "FAIL: interactive TUI missing RA"; exit 1; }
grep -qE "help|/plan|/code|Welcome to RA|Command" "$TUI_OUT" || { echo "FAIL: /help output missing"; exit 1; }
echo "✓ interactive TUI smoke (exit ${TUI_RC:-0})"

echo "▶ E2E: /models shows .251 qwen"
MODELS_OUT="$(mktemp)"
printf '/models\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$MODELS_OUT" >/dev/null
grep -q "RA models" "$MODELS_OUT" || { echo "FAIL: /models missing RA models"; cat "$MODELS_OUT"; exit 1; }
grep -qE "qwen3\.8|gemma" "$MODELS_OUT" || { echo "FAIL: /models missing qwen/gemma"; cat "$MODELS_OUT"; exit 1; }
grep -qE "small @(251|local)|@251|@local" "$MODELS_OUT" || { echo "FAIL: /models missing host tag"; cat "$MODELS_OUT"; exit 1; }
echo "✓ /models lists small Ollama"

# Seed happens inside runScenario after delete — but delete removes seed.
# For fix-bug, success check deletes hello.py then we re-seed — already handled.
# After model runs, ensure fixes recursive hello without print.

echo "▶ E2E: /status + /doctor"
STATUS_OUT="$(mktemp)"
printf '/status\n/doctor\n/clear\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$STATUS_OUT" >/dev/null
grep -q "RA status" "$STATUS_OUT" || { echo "FAIL: /status missing RA status"; exit 1; }
grep -q "cwd:" "$STATUS_OUT" || { echo "FAIL: /status missing cwd"; exit 1; }
grep -q "RA session cleared" "$STATUS_OUT" || { echo "FAIL: /clear missing"; exit 1; }
grep -q "RA doctor" "$STATUS_OUT" || { echo "FAIL: /doctor missing"; exit 1; }
grep -qE "qwen3\.8|251|Small Ollama" "$STATUS_OUT" || { echo "FAIL: /doctor missing .251/qwen"; exit 1; }
echo "✓ /status + /clear + /doctor"

echo "▶ E2E: TUI /quick FULL DEV (RA TUI + write file)"
WORKQ="$(mktemp -d /tmp/ra-tui-quick-XXXX)"
OUTQ="$(mktemp)"
set +e
(
  cd "$WORKQ"
  printf '/quick write a hello world function in one file\n/exit\n' | "${RA_BIN[@]}"
) 2>&1 | tee "$OUTQ"
set -e
grep -q "RA TUI" "$OUTQ" || { echo "FAIL: TUI /quick missing RA TUI splash"; exit 1; }
grep -qE "RA ✓ done|dev cycle complete" "$OUTQ" || { echo "FAIL: TUI /quick missing done"; exit 1; }
grep -qE "qwen3\.8|gemma" "$OUTQ" || { echo "FAIL: TUI /quick expected small model"; exit 1; }
grep -qE "glm-5\.2|qwen3\.8" "$OUTQ" || { echo "FAIL: TUI /quick expected code model"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "@251" "$OUTQ" || { echo "FAIL: TUI /quick missing @251 while .251+qwen up"; exit 1; }
  grep -q "RA lane thoth@251" "$OUTQ" || { echo "FAIL: TUI /quick missing RA lane thoth@251"; exit 1; }
fi
if [[ ! -f "$WORKQ/hello.py" && ! -f "$WORKQ/hello.js" && ! -f "$WORKQ/index.html" ]]; then
  echo "FAIL: TUI /quick wrote no file in $WORKQ"
  ls -la "$WORKQ" || true
  exit 1
fi
echo "✓ TUI /quick full-dev complete (file in $WORKQ)"

echo "▶ E2E: ra --task FULL DEV (RA TUI + write file)"
WORK="$(mktemp -d /tmp/ra-fulldev-XXXX)"
OUT="$(mktemp)"
set +e
(
  cd "$WORK"
  "${RA_BIN[@]}" --task "write a hello world function in one file" --quick --verify
) 2>&1 | tee "$OUT"
RC=${PIPESTATUS[0]}
set -e
if [[ "$RC" -ne 0 ]]; then
  echo "FAIL: ra --task exit $RC"
  exit "$RC"
fi
grep -q "RA verify" "$OUT" || { echo "FAIL: --verify output missing"; exit 1; }
grep -q "RA" "$OUT" || { echo "FAIL: RA name missing"; exit 1; }
grep -q "RA TUI" "$OUT" || { echo "FAIL: RA TUI splash missing"; exit 1; }
grep -qE "1\.0\.0-ra\.|v1\." "$OUT" || { echo "FAIL: version missing from RA TUI splash"; exit 1; }
grep -q "RA pipeline\|stage:" "$OUT" || { echo "FAIL: pipeline TUI missing"; exit 1; }
grep -qE "RA ✓ done|dev cycle complete" "$OUT" || { echo "FAIL: done banner missing"; exit 1; }
# Done box must embed live lane/prefer (TUI-visible mid-full-dev)
python3 -c "
import re,sys
t=open('$OUT').read()
# find first done banner block roughly
i=t.find('RA ✓ done')
assert i>=0, 'no done box'
chunk=t[i:i+2500]
assert 'RA lane' in chunk, chunk[:500]
assert 'RA prefer' in chunk, chunk[:500]
assert 'elapsed:' in chunk, chunk[:500]
assert 'files:' in chunk, chunk[:500]
" || { echo "FAIL: done box missing lane/prefer/elapsed/files"; exit 1; }
grep -qE "qwen3\.8|gemma" "$OUT" || { echo "FAIL: expected small model qwen3.8 or gemma"; exit 1; }
grep -qE "glm-5\.2|qwen3\.8" "$OUT" || { echo "FAIL: expected code model"; exit 1; }
grep -q "small/LAN" "$OUT" || { echo "FAIL: expected small/LAN lane tag in TUI"; exit 1; }
grep -qE "BIG/cloud|glm-5" "$OUT" || { echo "FAIL: expected BIG/cloud lane in TUI"; exit 1; }
grep -qE "@251|@local" "$OUT" || { echo "FAIL: expected @251 or @local host tag"; exit 1; }
grep -q "@cloud" "$OUT" || { echo "FAIL: expected @cloud host tag"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "@251" "$OUT" || { echo "FAIL: .251+qwen up but full-dev TUI missing @251"; exit 1; }
  grep -qE "RA RESULT.*hosts=.*251" "$OUT" || { echo "FAIL: .251 up but RA RESULT hosts missing 251"; exit 1; }
  grep -qE "RA lane thoth@251 → " "$OUT" || { echo "FAIL: full-dev missing RA lane thoth@251"; exit 1; }
fi
grep -qE "took [0-9]+ms" "$OUT" || { echo "FAIL: expected stage took Nms in TUI"; exit 1; }
grep -qE "RA /cost| in / " "$OUT" || { echo "FAIL: cost/usage TUI missing after full-dev"; exit 1; }
grep -qE "ollama-lan/|ollama-cloud/|qwen3\.8|glm-5" "$OUT" || { echo "FAIL: usage models missing"; exit 1; }
grep -q "RA RESULT" "$OUT" || { echo "FAIL: RA RESULT line missing"; exit 1; }
grep -qE "RA RESULT.*thoth.*ptah" "$OUT" || { echo "FAIL: RA RESULT missing stages"; exit 1; }
grep -qE "RA RESULT.*(qwen3\.8|gemma)" "$OUT" || { echo "FAIL: RA RESULT missing small model"; exit 1; }
if grep -qE "RA RESULT.*files=none" "$OUT"; then echo "FAIL: RA RESULT files=none"; exit 1; fi
grep -qE "RA RESULT.*files=/.+" "$OUT" || { echo "FAIL: RA RESULT missing written file path"; exit 1; }
grep -qE "RA RESULT.*ms=[0-9]+" "$OUT" || { echo "FAIL: RA RESULT missing ms="; exit 1; }
grep -qE "RA RESULT.*hosts=.*(251|local)" "$OUT" || { echo "FAIL: RA RESULT missing hosts=251|local"; exit 1; }
grep -qE "RA RESULT.*intent=" "$OUT" || { echo "FAIL: RA RESULT missing intent="; exit 1; }
grep -q "RA intent code" "$OUT" || { echo "FAIL: full-dev missing RA intent code"; exit 1; }
grep -qE "RA prefer small@(251|local) → big@cloud" "$OUT" || { echo "FAIL: full-dev missing live RA prefer"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA prefer small@251 → big@cloud" "$OUT" || { echo "FAIL: full-dev prefer not @251"; exit 1; }
fi
grep -q "again: ra again --quick --verify" "$OUT" || { echo "FAIL: full-dev missing again tip"; exit 1; }
grep -qE "RA RESULT.*cwd=/" "$OUT" || { echo "FAIL: RA RESULT missing cwd="; exit 1; }
grep -qE "RA RESULT.*stages_n=[0-9]+" "$OUT" || { echo "FAIL: RA RESULT missing stages_n="; exit 1; }
# Full-dev should leave a working code file in WORK
if [[ -f "$WORK/hello.py" ]]; then
  grep -q 'print\|return' "$WORK/hello.py" || { echo "FAIL: hello.py has no print/return"; cat "$WORK/hello.py"; exit 1; }
elif [[ ! -f "$WORK/hello.js" && ! -f "$WORK/index.html" ]]; then
  echo "FAIL: no code file written in $WORK"
  ls -la "$WORK" || true
  exit 1
fi
echo "✓ RA TUI full-dev complete (file written in $WORK)"
if [[ -f "$WORK/hello.py" ]]; then
  echo "── hello.py ──"
  head -20 "$WORK/hello.py"
  echo "▶ run hello.py"
  PY_OUT="$(python3 "$WORK/hello.py" 2>&1)" || { echo "FAIL: hello.py crashed: $PY_OUT"; exit 1; }
  echo "$PY_OUT" | grep -qi hello || { echo "FAIL: hello.py output missing hello: $PY_OUT"; exit 1; }
  echo "✓ hello.py runs → $PY_OUT"
fi

echo "▶ TUI welcome shows last RA lane after full-dev"
WELCOME_DIR="$(mktemp -d /tmp/ra-welcome-XXXX)"
WELCOME_OUT="$(mktemp)"
printf '/exit\n' | "${RA_BIN[@]}" --project "$WELCOME_DIR" 2>&1 | tee "$WELCOME_OUT" >/dev/null
grep -q "Welcome to RA" "$WELCOME_OUT" || { echo "FAIL: welcome missing after full-dev"; cat "$WELCOME_OUT"; exit 1; }
grep -qE "RA lane " "$WELCOME_OUT" || { echo "FAIL: welcome missing RA lane after full-dev"; cat "$WELCOME_OUT"; exit 1; }
grep -qE "RA intent (code|debug|plan|review|docs|question)" "$WELCOME_OUT" || { echo "FAIL: welcome missing RA intent"; cat "$WELCOME_OUT"; exit 1; }
grep -q "/verify" "$WELCOME_OUT" || { echo "FAIL: welcome missing /verify tip"; cat "$WELCOME_OUT"; exit 1; }
grep -qE "elapsed: [0-9]" "$WELCOME_OUT" || { echo "FAIL: welcome missing elapsed"; cat "$WELCOME_OUT"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" "$WELCOME_OUT" || { echo "FAIL: welcome lane not @251"; exit 1; }
fi
echo "✓ TUI welcome last lane"

echo "▶ ra verify (re-check last full-dev, no LLM)"
"${RA_BIN[@]}" verify | tee /tmp/ra-verify.txt
grep -q "RA verify" /tmp/ra-verify.txt || { echo "FAIL: ra verify missing header"; exit 1; }
grep -q "RA verify OK" /tmp/ra-verify.txt || { echo "FAIL: ra verify not OK"; cat /tmp/ra-verify.txt; exit 1; }
grep -qi hello /tmp/ra-verify.txt || { echo "FAIL: ra verify missing hello output"; exit 1; }
grep -qE "RA lane " /tmp/ra-verify.txt || { echo "FAIL: ra verify missing RA lane"; cat /tmp/ra-verify.txt; exit 1; }
grep -qE "RA intent (code|debug|plan|review|docs|question)" /tmp/ra-verify.txt || { echo "FAIL: ra verify missing RA intent"; cat /tmp/ra-verify.txt; exit 1; }
grep -qE "elapsed: [0-9]" /tmp/ra-verify.txt || { echo "FAIL: ra verify missing elapsed"; cat /tmp/ra-verify.txt; exit 1; }
grep -q "again: ra again" /tmp/ra-verify.txt || { echo "FAIL: ra verify missing again tip"; cat /tmp/ra-verify.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-verify.txt || { echo "FAIL: ra verify lane not @251"; exit 1; }
fi
VERIFY_TUI="$(mktemp)"
printf '/verify\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$VERIFY_TUI" >/dev/null
grep -q "RA verify" "$VERIFY_TUI" || { echo "FAIL: /verify missing RA verify"; cat "$VERIFY_TUI"; exit 1; }
grep -qE "RA lane " "$VERIFY_TUI" || { echo "FAIL: /verify missing RA lane"; cat "$VERIFY_TUI"; exit 1; }
grep -q "again: ra again" "$VERIFY_TUI" || { echo "FAIL: /verify missing again tip"; cat "$VERIFY_TUI"; exit 1; }
echo "✓ ra verify"

echo "▶ ra status"
"${RA_BIN[@]}" status | tee /tmp/ra-status.txt
grep -q "RA status" /tmp/ra-status.txt || { echo "FAIL: ra status missing header"; exit 1; }
grep -qE "qwen3\.8|small:" /tmp/ra-status.txt || { echo "FAIL: ra status missing small/qwen"; exit 1; }
grep -qE "timings:.*@(251|local)|hosts:.*(251|local)|files:" /tmp/ra-status.txt || { echo "FAIL: ra status missing last full-dev"; cat /tmp/ra-status.txt; exit 1; }
grep -qE "RA lane " /tmp/ra-status.txt || { echo "FAIL: ra status missing RA lane"; cat /tmp/ra-status.txt; exit 1; }
grep -q "again: ra again" /tmp/ra-status.txt || { echo "FAIL: ra status missing again tip"; cat /tmp/ra-status.txt; exit 1; }
grep -qE "RA prefer small@(251|local)" /tmp/ra-status.txt || { echo "FAIL: ra status missing RA prefer"; cat /tmp/ra-status.txt; exit 1; }
grep -qE "RA intent (code|debug|plan|review|docs|question)" /tmp/ra-status.txt || { echo "FAIL: ra status missing RA intent"; cat /tmp/ra-status.txt; exit 1; }
grep -qE "elapsed: [0-9]" /tmp/ra-status.txt || { echo "FAIL: ra status missing elapsed"; cat /tmp/ra-status.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-status.txt || { echo "FAIL: ra status lane not @251"; exit 1; }
fi
echo "✓ ra status"

echo "▶ ra last"
"${RA_BIN[@]}" last | tee /tmp/ra-last.txt
grep -q "RA RESULT" /tmp/ra-last.txt || { echo "FAIL: ra last missing RA RESULT"; exit 1; }
grep -qE "qwen3\.8|gemma|glm-5" /tmp/ra-last.txt || { echo "FAIL: ra last missing models"; exit 1; }
grep -qE "timings:.*@(251|local|cloud)" /tmp/ra-last.txt || { echo "FAIL: ra last missing timings"; cat /tmp/ra-last.txt; exit 1; }
grep -qE "RA lane " /tmp/ra-last.txt || { echo "FAIL: ra last missing RA lane"; cat /tmp/ra-last.txt; exit 1; }
grep -qE "RA intent (code|debug|plan|review|docs|question)" /tmp/ra-last.txt || { echo "FAIL: ra last missing RA intent"; cat /tmp/ra-last.txt; exit 1; }
grep -qE "RA prefer small@(251|local)" /tmp/ra-last.txt || { echo "FAIL: ra last missing RA prefer"; cat /tmp/ra-last.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-last.txt || { echo "FAIL: ra last lane not @251"; exit 1; }
  grep -q "RA prefer small@251" /tmp/ra-last.txt || { echo "FAIL: ra last prefer not @251"; exit 1; }
fi
echo "✓ ra last"

echo "▶ ra last --json"
"${RA_BIN[@]}" last --json | tee /tmp/ra-last-json.txt
grep -q '"filesWritten"' /tmp/ra-last-json.txt || { echo "FAIL: last --json missing filesWritten"; exit 1; }
grep -qE '"intent"|"hosts"|"models"' /tmp/ra-last-json.txt || { echo "FAIL: last --json missing fields"; exit 1; }
grep -q '"timings"' /tmp/ra-last-json.txt || { echo "FAIL: last --json missing timings"; exit 1; }
python3 -c "import json,sys; d=json.load(open('/tmp/ra-last-json.txt')); assert d.get('filesWritten'), d; assert d.get('intent'), d; assert d.get('cwd'), d; assert isinstance(d.get('timings'), list) and len(d['timings'])>=1 and d['timings'][0].get('host')" \
  || { echo "FAIL: last --json not valid / empty files/intent/cwd/timings"; exit 1; }
echo "✓ ra last --json"

echo "▶ ra result"
"${RA_BIN[@]}" result | tee /tmp/ra-result.txt
grep -q "RA RESULT" /tmp/ra-result.txt || { echo "FAIL: ra result missing RA RESULT"; exit 1; }
grep -qE "cwd=/" /tmp/ra-result.txt || { echo "FAIL: ra result missing cwd="; cat /tmp/ra-result.txt; exit 1; }
grep -qE "hosts=.*(251|local)" /tmp/ra-result.txt || { echo "FAIL: ra result missing hosts"; exit 1; }
grep -qE "RA lane .+@" /tmp/ra-result.txt || { echo "FAIL: ra result missing RA lane"; cat /tmp/ra-result.txt; exit 1; }
grep -qE "RA intent (code|debug|plan|review|docs|question)" /tmp/ra-result.txt || { echo "FAIL: ra result missing RA intent"; cat /tmp/ra-result.txt; exit 1; }
grep -q "again: ra again" /tmp/ra-result.txt || { echo "FAIL: ra result missing again tip"; cat /tmp/ra-result.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-result.txt || { echo "FAIL: ra result lane not @251"; exit 1; }
fi
RESULT_OUT="$(mktemp)"
printf '/result\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$RESULT_OUT" >/dev/null
grep -q "RA RESULT" "$RESULT_OUT" || { echo "FAIL: /result missing RA RESULT"; cat "$RESULT_OUT"; exit 1; }
grep -qE "RA intent (code|debug|plan|review|docs|question)" "$RESULT_OUT" || { echo "FAIL: /result missing RA intent"; cat "$RESULT_OUT"; exit 1; }
grep -q "again: ra again" "$RESULT_OUT" || { echo "FAIL: /result missing again tip"; cat "$RESULT_OUT"; exit 1; }
echo "✓ ra result"

echo "▶ ra lane"
"${RA_BIN[@]}" lane | tee /tmp/ra-lane.txt
grep -qE "^RA lane " /tmp/ra-lane.txt || { echo "FAIL: ra lane missing header"; cat /tmp/ra-lane.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-lane.txt || { echo "FAIL: ra lane not @251"; exit 1; }
fi
if grep -q "✓ cloud" /tmp/ra-ping.txt; then
  grep -q "ptah@cloud" /tmp/ra-lane.txt || { echo "FAIL: ra lane missing ptah@cloud"; exit 1; }
fi
LANE_TUI="$(mktemp)"
printf '/lane\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$LANE_TUI" >/dev/null
grep -q "RA lane" "$LANE_TUI" || { echo "FAIL: /lane missing RA lane"; cat "$LANE_TUI"; exit 1; }
echo "✓ ra lane"

echo "▶ ra intent"
"${RA_BIN[@]}" intent | tee /tmp/ra-intent.txt
grep -qE "^RA intent (code|debug|plan|review|docs|question)" /tmp/ra-intent.txt || { echo "FAIL: ra intent missing tag"; cat /tmp/ra-intent.txt; exit 1; }
INTENT_TUI="$(mktemp)"
printf '/intent\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$INTENT_TUI" >/dev/null
grep -qE "RA intent (code|debug|plan|review|docs|question)" "$INTENT_TUI" || { echo "FAIL: /intent missing RA intent"; cat "$INTENT_TUI"; exit 1; }
echo "✓ ra intent"

echo "▶ ra prefer"
"${RA_BIN[@]}" prefer | tee /tmp/ra-prefer.txt
grep -qE "^RA prefer small@(251|local) → big@cloud" /tmp/ra-prefer.txt || { echo "FAIL: ra prefer missing line"; cat /tmp/ra-prefer.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA prefer small@251 → big@cloud" /tmp/ra-prefer.txt || { echo "FAIL: ra prefer not @251"; exit 1; }
fi
PREF_TUI="$(mktemp)"
printf '/prefer\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$PREF_TUI" >/dev/null
grep -qE "RA prefer small@(251|local)" "$PREF_TUI" || { echo "FAIL: /prefer missing RA prefer"; cat "$PREF_TUI"; exit 1; }
echo "✓ ra prefer"

echo "▶ ra timings"
"${RA_BIN[@]}" timings | tee /tmp/ra-timings.txt
grep -q "RA timings" /tmp/ra-timings.txt || { echo "FAIL: ra timings missing header"; exit 1; }
grep -qE "thoth@(251|local)" /tmp/ra-timings.txt || { echo "FAIL: ra timings missing thoth@251|local"; cat /tmp/ra-timings.txt; exit 1; }
grep -qE "qwen3\.8|gemma" /tmp/ra-timings.txt || { echo "FAIL: ra timings missing small model"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "thoth@251" /tmp/ra-timings.txt || { echo "FAIL: .251+qwen up but thoth not @251 (got local fallback?)"; cat /tmp/ra-timings.txt; exit 1; }
fi
if grep -q "✓ cloud" /tmp/ra-ping.txt; then
  grep -q "ptah@cloud" /tmp/ra-timings.txt || { echo "FAIL: cloud up but ptah not @cloud"; cat /tmp/ra-timings.txt; exit 1; }
fi
grep -qE "RA lane " /tmp/ra-timings.txt || { echo "FAIL: ra timings missing RA lane"; cat /tmp/ra-timings.txt; exit 1; }
grep -qE "RA prefer small@(251|local)" /tmp/ra-timings.txt || { echo "FAIL: ra timings missing RA prefer"; cat /tmp/ra-timings.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-timings.txt || { echo "FAIL: ra timings lane not @251"; exit 1; }
fi
TIMINGS_OUT="$(mktemp)"
printf '/timings\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$TIMINGS_OUT" >/dev/null
grep -q "RA timings" "$TIMINGS_OUT" || { echo "FAIL: /timings missing RA timings"; cat "$TIMINGS_OUT"; exit 1; }
grep -qE "RA lane " "$TIMINGS_OUT" || { echo "FAIL: /timings missing RA lane"; cat "$TIMINGS_OUT"; exit 1; }
echo "✓ ra timings"

echo "▶ ra summary"
"${RA_BIN[@]}" summary | tee /tmp/ra-summary.txt
grep -q "RA summary" /tmp/ra-summary.txt || { echo "FAIL: ra summary missing header"; exit 1; }
grep -q "RA RESULT" /tmp/ra-summary.txt || { echo "FAIL: ra summary missing RA RESULT"; exit 1; }
grep -qE "thoth@(251|local)|lane:.*thoth@" /tmp/ra-summary.txt || { echo "FAIL: ra summary missing lane timings"; cat /tmp/ra-summary.txt; exit 1; }
grep -qE "RA lane " /tmp/ra-summary.txt || { echo "FAIL: ra summary missing RA lane"; exit 1; }
grep -q "again: ra again" /tmp/ra-summary.txt || { echo "FAIL: ra summary missing again tip"; cat /tmp/ra-summary.txt; exit 1; }
grep -qE "RA prefer small@(251|local)" /tmp/ra-summary.txt || { echo "FAIL: ra summary missing RA prefer"; cat /tmp/ra-summary.txt; exit 1; }
grep -qE "elapsed: [0-9]" /tmp/ra-summary.txt || { echo "FAIL: ra summary missing elapsed"; cat /tmp/ra-summary.txt; exit 1; }
SUM_TUI="$(mktemp)"
printf '/summary\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$SUM_TUI" >/dev/null
grep -q "RA summary" "$SUM_TUI" || { echo "FAIL: /summary missing RA summary"; cat "$SUM_TUI"; exit 1; }
grep -q "again: ra again" "$SUM_TUI" || { echo "FAIL: /summary missing again tip"; cat "$SUM_TUI"; exit 1; }
grep -qE "RA prefer small@(251|local)" "$SUM_TUI" || { echo "FAIL: /summary missing RA prefer"; cat "$SUM_TUI"; exit 1; }
echo "✓ ra summary"

echo "▶ ra show + TUI /show"
"${RA_BIN[@]}" show | tee /tmp/ra-show.txt
grep -q "RA show" /tmp/ra-show.txt || { echo "FAIL: ra show missing RA show"; exit 1; }
grep -qE "hello|def |print|html|function" /tmp/ra-show.txt || { echo "FAIL: ra show empty body"; cat /tmp/ra-show.txt; exit 1; }
if grep -q "hello.py" /tmp/ra-show.txt; then
  grep -q "__main__" /tmp/ra-show.txt || { echo "FAIL: hello.py show missing __main__ entrypoint"; cat /tmp/ra-show.txt; exit 1; }
fi
grep -qE "RA lane " /tmp/ra-show.txt || { echo "FAIL: ra show missing RA lane footer"; cat /tmp/ra-show.txt; exit 1; }
grep -qE "RA prefer small@(251|local)" /tmp/ra-show.txt || { echo "FAIL: ra show missing RA prefer footer"; cat /tmp/ra-show.txt; exit 1; }
grep -qE "elapsed: [0-9]" /tmp/ra-show.txt || { echo "FAIL: ra show missing elapsed"; cat /tmp/ra-show.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-show.txt || { echo "FAIL: ra show lane not @251"; exit 1; }
fi
SHOW_OUT="$(mktemp)"
printf '/show\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$SHOW_OUT" >/dev/null
grep -q "RA show" "$SHOW_OUT" || { echo "FAIL: /show missing RA show"; cat "$SHOW_OUT"; exit 1; }
grep -qE "RA lane " "$SHOW_OUT" || { echo "FAIL: /show missing RA lane footer"; cat "$SHOW_OUT"; exit 1; }
echo "✓ ra show"

echo "▶ ra cost"
"${RA_BIN[@]}" cost | tee /tmp/ra-cost.txt
grep -q "RA cost" /tmp/ra-cost.txt || { echo "FAIL: ra cost missing header"; exit 1; }
grep -qE "qwen3\.8|gemma|glm-5|ollama|usage|token|No usage" /tmp/ra-cost.txt || { echo "FAIL: ra cost empty"; cat /tmp/ra-cost.txt; exit 1; }
grep -qE "RA prefer small@(251|local)" /tmp/ra-cost.txt || { echo "FAIL: ra cost missing RA prefer"; cat /tmp/ra-cost.txt; exit 1; }
grep -qE "RA lane " /tmp/ra-cost.txt || { echo "FAIL: ra cost missing RA lane after full-dev"; cat /tmp/ra-cost.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-cost.txt || { echo "FAIL: ra cost lane not @251"; exit 1; }
fi
COST_TUI="$(mktemp)"
printf '/cost\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$COST_TUI" >/dev/null
grep -q "RA cost" "$COST_TUI" || { echo "FAIL: /cost missing RA cost"; cat "$COST_TUI"; exit 1; }
grep -qE "RA prefer small@(251|local)" "$COST_TUI" || { echo "FAIL: /cost missing RA prefer"; cat "$COST_TUI"; exit 1; }
echo "✓ ra cost"

echo "▶ ra home after full-dev"
"${RA_BIN[@]}" home | tee /tmp/ra-home-after.txt
grep -q "last-cwd:" /tmp/ra-home-after.txt || { echo "FAIL: ra home missing last-cwd"; exit 1; }
grep -qE "last-cwd: /.+" /tmp/ra-home-after.txt || { echo "FAIL: ra home last-cwd empty after full-dev"; cat /tmp/ra-home-after.txt; exit 1; }
grep -qE "RA lane " /tmp/ra-home-after.txt || { echo "FAIL: ra home missing RA lane after full-dev"; cat /tmp/ra-home-after.txt; exit 1; }
grep -qE "RA intent (code|debug|plan|review|docs|question)" /tmp/ra-home-after.txt || { echo "FAIL: ra home missing RA intent"; cat /tmp/ra-home-after.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-home-after.txt || { echo "FAIL: ra home lane not @251"; exit 1; }
fi
HOME_TUI="$(mktemp)"
printf '/home\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$HOME_TUI" >/dev/null
grep -q "RA home" "$HOME_TUI" || { echo "FAIL: /home missing RA home"; cat "$HOME_TUI"; exit 1; }
grep -qE "RA lane " "$HOME_TUI" || { echo "FAIL: /home missing RA lane"; cat "$HOME_TUI"; exit 1; }
echo "✓ ra home after full-dev"

echo "▶ ra doctor after full-dev (shows RA lane)"
"${RA_BIN[@]}" doctor | tee /tmp/ra-doctor-after.txt
grep -q "RA doctor" /tmp/ra-doctor-after.txt || { echo "FAIL: doctor after full-dev missing banner"; exit 1; }
grep -qE "RA lane " /tmp/ra-doctor-after.txt || { echo "FAIL: doctor after full-dev missing RA lane"; cat /tmp/ra-doctor-after.txt; exit 1; }
grep -qE "RA intent (code|debug|plan|review|docs|question)" /tmp/ra-doctor-after.txt || { echo "FAIL: doctor after full-dev missing RA intent"; cat /tmp/ra-doctor-after.txt; exit 1; }
grep -q "again: ra again" /tmp/ra-doctor-after.txt || { echo "FAIL: doctor after full-dev missing again tip"; cat /tmp/ra-doctor-after.txt; exit 1; }
grep -qE "RA prefer small@(251|local)" /tmp/ra-doctor-after.txt || { echo "FAIL: doctor after full-dev missing RA prefer"; cat /tmp/ra-doctor-after.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-doctor-after.txt || { echo "FAIL: doctor lane not @251"; exit 1; }
  grep -q "RA prefer small@251" /tmp/ra-doctor-after.txt || { echo "FAIL: doctor prefer not @251"; exit 1; }
  grep -qE "Small Ollama \(@251" /tmp/ra-doctor-after.txt || { echo "FAIL: doctor after full-dev not @251"; exit 1; }
fi
echo "✓ ra doctor after full-dev"

echo "▶ ra selfcheck after full-dev (lane from last run)"
"${RA_BIN[@]}" selfcheck | tee /tmp/ra-selfcheck-after.txt
grep -q "RA selfcheck OK" /tmp/ra-selfcheck-after.txt || { echo "FAIL: selfcheck after full-dev not OK"; exit 1; }
grep -qE "RA lane " /tmp/ra-selfcheck-after.txt || { echo "FAIL: selfcheck after full-dev missing RA lane"; cat /tmp/ra-selfcheck-after.txt; exit 1; }
grep -qE "RA prefer small@(251|local)" /tmp/ra-selfcheck-after.txt || { echo "FAIL: selfcheck after full-dev missing prefer"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-selfcheck-after.txt || { echo "FAIL: selfcheck lane not @251"; exit 1; }
fi
echo "✓ ra selfcheck after full-dev"

echo "▶ ra again --quick --verify (re-run last full-dev)"
"${RA_BIN[@]}" again --quick --verify | tee /tmp/ra-again.txt
grep -q "RA again" /tmp/ra-again.txt || { echo "FAIL: ra again missing RA again banner"; cat /tmp/ra-again.txt; exit 1; }
grep -qE "RA intent (code|debug|plan|review|docs|question)" /tmp/ra-again.txt || { echo "FAIL: ra again missing RA intent before re-run"; cat /tmp/ra-again.txt; exit 1; }
grep -qE "RA RESULT|Files:|wrote|hello\.py|index\.html" /tmp/ra-again.txt || { echo "FAIL: ra again missing artifact signal"; cat /tmp/ra-again.txt; exit 1; }
grep -qE "RA lane " /tmp/ra-again.txt || { echo "FAIL: ra again missing RA lane"; cat /tmp/ra-again.txt; exit 1; }
grep -q "RA again verify" /tmp/ra-again.txt || { echo "FAIL: ra again missing verify block"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-again.txt || { echo "FAIL: ra again lane not @251"; exit 1; }
fi
AGAIN_TUI="$(mktemp)"
printf '/again\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$AGAIN_TUI" >/dev/null
grep -q "RA again" "$AGAIN_TUI" || { echo "FAIL: /again missing RA again"; cat "$AGAIN_TUI"; exit 1; }
grep -qE "RA intent (code|debug|plan|review|docs|question)" "$AGAIN_TUI" || { echo "FAIL: /again missing RA intent"; cat "$AGAIN_TUI"; exit 1; }
grep -qE "RA full-dev|Files:" "$AGAIN_TUI" || { echo "FAIL: /again missing full-dev"; cat "$AGAIN_TUI"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" "$AGAIN_TUI" || { echo "FAIL: /again lane not @251"; cat "$AGAIN_TUI"; exit 1; }
fi
echo "✓ ra again"

echo "▶ E2E: /files after full-dev"
"${RA_BIN[@]}" files | tee /tmp/ra-files.txt
grep -q "RA files" /tmp/ra-files.txt || { echo "FAIL: ra files missing header"; cat /tmp/ra-files.txt; exit 1; }
grep -qE "hello\.py|index\.html" /tmp/ra-files.txt || { echo "FAIL: ra files missing artifact"; cat /tmp/ra-files.txt; exit 1; }
grep -qE "RA lane " /tmp/ra-files.txt || { echo "FAIL: ra files missing RA lane"; cat /tmp/ra-files.txt; exit 1; }
grep -qE "RA prefer small@(251|local)" /tmp/ra-files.txt || { echo "FAIL: ra files missing RA prefer"; cat /tmp/ra-files.txt; exit 1; }
grep -qE "elapsed: [0-9]" /tmp/ra-files.txt || { echo "FAIL: ra files missing elapsed"; cat /tmp/ra-files.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "RA lane thoth@251" /tmp/ra-files.txt || { echo "FAIL: ra files lane not @251"; exit 1; }
fi
FILES_OUT="$(mktemp)"
printf '/files\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$FILES_OUT" >/dev/null
grep -q "RA files" "$FILES_OUT" || { echo "FAIL: /files missing RA files"; exit 1; }
grep -qE "hello\.py|index\.html" "$FILES_OUT" || { echo "FAIL: /files missing artifact"; cat "$FILES_OUT"; exit 1; }
grep -qE "RA lane " "$FILES_OUT" || { echo "FAIL: /files missing RA lane"; cat "$FILES_OUT"; exit 1; }
grep -qE "elapsed: [0-9]" "$FILES_OUT" || { echo "FAIL: /files missing elapsed"; cat "$FILES_OUT"; exit 1; }
echo "✓ /files"

echo "▶ E2E: /ls"
LS_OUT="$(mktemp)"
printf '/ls\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$LS_OUT" >/dev/null
grep -q "RA ls" "$LS_OUT" || { echo "FAIL: /ls missing RA ls"; exit 1; }
echo "✓ /ls"

echo "▶ ra history + /history"
"${RA_BIN[@]}" history | tee /tmp/ra-hist.txt
grep -q "RA history" /tmp/ra-hist.txt || { echo "FAIL: ra history missing header"; exit 1; }
grep -qE "hello\.py|index\.html|thoth" /tmp/ra-hist.txt || { echo "FAIL: ra history empty/missing runs"; exit 1; }
grep -qE "\{(code|debug|plan|review|docs|question)\}" /tmp/ra-hist.txt || { echo "FAIL: ra history missing {intent}"; cat /tmp/ra-hist.txt; exit 1; }
grep -qE "thoth@(251|local)" /tmp/ra-hist.txt || { echo "FAIL: ra history missing thoth@251|local lane tag"; cat /tmp/ra-hist.txt; exit 1; }
grep -qE "^RA lane |^RA prefer " /tmp/ra-hist.txt || { echo "FAIL: ra history missing latest lane/prefer header"; cat /tmp/ra-hist.txt; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "thoth@251" /tmp/ra-hist.txt || { echo "FAIL: ra history missing thoth@251"; exit 1; }
  grep -q "RA prefer small@251" /tmp/ra-hist.txt || { echo "FAIL: ra history prefer not @251"; exit 1; }
fi
HIST_OUT="$(mktemp)"
printf '/history\n/exit\n' | "${RA_BIN[@]}" 2>&1 | tee "$HIST_OUT" >/dev/null
grep -q "RA history" "$HIST_OUT" || { echo "FAIL: /history missing"; exit 1; }
grep -qE "thoth@(251|local)" "$HIST_OUT" || { echo "FAIL: /history missing lane tag"; cat "$HIST_OUT"; exit 1; }
grep -qE "RA prefer small@(251|local)" "$HIST_OUT" || { echo "FAIL: /history missing RA prefer"; cat "$HIST_OUT"; exit 1; }
"${RA_BIN[@]}" history --json | tee /tmp/ra-hist-json.txt >/dev/null
python3 -c "import json; d=json.load(open('/tmp/ra-hist-json.txt')); assert isinstance(d,list) and len(d)>=1 and d[0].get('filesWritten') is not None" \
  || { echo "FAIL: history --json invalid"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  python3 -c "import json; d=json.load(open('/tmp/ra-hist-json.txt')); assert any('251' in (r.get('hosts') or []) for r in d[:5]), d[:2]" \
    || { echo "FAIL: history --json missing hosts 251 after .251 full-devs"; exit 1; }
fi
echo "✓ history"

echo "▶ E2E: orchestrator creates file"
WORK2="$(mktemp -d /tmp/ra-work-XXXX)"
bun -e "
import { runOrchestratorTurn } from '../ra/src/agent.ts';
import { loadRaConfig } from './src/config.ts';
const cfg = loadRaConfig('$ROOT');
const out = await runOrchestratorTurn('Create index.html hello world page', cfg, { cwd: '$WORK2' });
console.log(out.slice(0, 300));
"
test -f "$WORK2/index.html"
grep -qi hello "$WORK2/index.html"
echo "✓ orchestrator wrote index.html with hello"

echo "▶ ra benchmark run all (must show RA TUI)"
BENCH_OUT="$(mktemp)"
set +e
"${RA_BIN[@]}" benchmark run all 2>&1 | tee "$BENCH_OUT"
BENCH_RC=${PIPESTATUS[0]}
set -e
[[ "$BENCH_RC" -eq 0 ]] || { echo "FAIL: benchmark run all exit $BENCH_RC"; exit "$BENCH_RC"; }
grep -q "RA TUI" "$BENCH_OUT" || { echo "FAIL: benchmark missing RA TUI"; exit 1; }
grep -q "RA benchmark" "$BENCH_OUT" || { echo "FAIL: benchmark missing RA benchmark banner"; exit 1; }
grep -q "RA prefer small@251" "$BENCH_OUT" || { echo "FAIL: benchmark missing RA prefer"; exit 1; }
grep -q "RA benchmark OK" "$BENCH_OUT" || { echo "FAIL: benchmark missing RA benchmark OK"; exit 1; }
grep -qE "RA pipeline|stage:" "$BENCH_OUT" || { echo "FAIL: benchmark missing pipeline TUI"; exit 1; }
grep -qE "qwen3\.8|gemma" "$BENCH_OUT" || { echo "FAIL: benchmark missing small model"; exit 1; }
grep -qE "@251|@local" "$BENCH_OUT" || { echo "FAIL: benchmark missing host tag"; exit 1; }
if grep -q "✓ 251" /tmp/ra-ping.txt && grep -q "qwen3" /tmp/ra-ping.txt; then
  grep -q "@251" "$BENCH_OUT" || { echo "FAIL: benchmark missing @251 while .251+qwen up"; exit 1; }
  grep -q "RA lane thoth@251" "$BENCH_OUT" || { echo "FAIL: benchmark missing RA lane thoth@251"; exit 1; }
fi
grep -qE "hosts=.*(251|local)" "$BENCH_OUT" || { echo "FAIL: benchmark missing hosts= in RA RESULT"; exit 1; }
grep -q "fix-bug" "$BENCH_OUT" || { echo "FAIL: fix-bug scenario not run"; exit 1; }
grep -qE "fix-bug.*intent=debug|RA intent debug" "$BENCH_OUT" || { echo "FAIL: fix-bug missing intent=debug"; grep -E "RA RESULT|RA intent|fix-bug" "$BENCH_OUT" | tail -20; exit 1; }
echo "✓ benchmark run all shows RA TUI (smoke+cookie+todo+fix-bug)"

echo
echo "╔══════════════════════════════════════╗"
echo "║  RA GATE — all checks passed         ║"
echo "╠══════════════════════════════════════╣"
echo "║  • unit + routing (qwen3.8 / gemma)  ║"
echo "║  • doctor + ping (.251 preferred)    ║"
echo "║  • selfcheck (which+lanes+models)   ║"
echo "║  • RA TUI full-dev @251 → @cloud     ║"
echo "║  • RA lane + verify + benchmarks     ║"
echo "╚══════════════════════════════════════╝"
echo "✓ RA test suite passed"
