#!/usr/bin/env bash
# raker self-check: verify the parse rules in SKILL.md are internally consistent.
# One runnable check that fails if the documented separator priority drifts.
# Run: bash scripts/selfcheck.sh
#
# ponytail: this is the smallest check that fails if the SKILL.md parse logic
# breaks. No framework, no fixtures. Scope ceiling: only validates the Parse
# separator list and the two sentinel strings; upgrade to a real parser test if
# the parse rules grow beyond a flat ordered list.
set -euo pipefail

SKILL="${1:-$(dirname "$0")/../SKILL.md}"

# Scope to the block from "in priority order" up to (not including) the next
# markdown heading. That block holds exactly the "1. ... 5. ..." separator list.
SLICE=$(sed -n '/in priority order/,/^##/p' "$SKILL")

ACTUAL=$(printf '%s\n' "$SLICE" \
  | grep -E '^[1-5]\. ' \
  | grep -oE '`[^`]+`' \
  | sed 's/`//g; s/  */ /g' \
  | sed 's/^ //; s/ $//' \
  | tr '\n' ' ' \
  | sed 's/ $//')

EXPECTED="until | # // when so that then ;"

if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "FAIL: SKILL.md parse order drifted"
  echo "  expected: $EXPECTED"
  echo "  actual:   $ACTUAL"
  exit 1
fi

grep -q 'RAKER_DONE_<PURPOSE>' "$SKILL" || { echo "FAIL: done-marker RAKER_DONE_<PURPOSE> missing"; exit 1; }
grep -q 'RAKER_TICK_<PURPOSE>' "$SKILL" || { echo "FAIL: wake sentinel RAKER_TICK_<PURPOSE> missing"; exit 1; }

echo "OK: raker skill self-check passed"
