# RA × External Benchmarks — RESULTS (Wave 5)

Date: 2026-11-10 · CLI: `bun ra/src/cli.ts` at commit `5cf2d24` (+ adapter commits
below) · Harness: `ra bench external` (see [EXTERNAL-BENCH.md](EXTERNAL-BENCH.md))

## Methodology

- **Suites**: HumanEval+ v0.1.10 (OriginFmt, 164 tasks) and Aider polyglot
  benchmark — python slice only (34 Exercism practice exercises).
- **Model/lane**: `codder/claude-sonnet-5-5` via a private cloud gateway (redacted)
  (OpenAI-compatible provider block in `RA_CONFIG=/tmp/ra-e2e/ra-codder.json`,
  key from gitignored `anubis/.env`), model pinned across tier/role/router
  surfaces by the harness so results are attributable. `RA_LOCAL_ONLY=1` on
  every run — no localhost fallback.
- **Prompt**: HumanEval+ = task prompt + "save the complete function in
  solution.py"; polyglot = `.docs/instructions.md` (+append) + "replace the
  stub in <file>, tests are in this directory, don't modify them".
- **Verify**: HumanEval+ = candidate appended to the task prompt + the suite's
  own `test` payload + `check(entry_point)` in a sandboxed python3 subprocess
  (60 s timeout); polyglot = the exercise's PRISTINE `*_test.py` (from the
  cache, immune to agent tampering) run against the agent's implementation
  (30 s timeout). One attempt per task (Aider's harness allows two; ours is
  stricter, noted below).
- **Environment**: macOS system python3 3.9.6 (numpy 2.0.2 available);
  verifier prepends a PEP-263 UTF-8 header (HE+/12 and /14 embed non-ASCII).
- **Spend cap**: $2.50 declared for the wave; **$1.67 actually spent**
  (plus ~$0.02 on canaries). The polyglot run hit its own $1.20 sub-cap after
  9 tasks and stopped (10th task not attempted).

## Results

| Suite | N | Model | pass@1 | mean latency | cost |
| --- | --- | --- | --- | --- | --- |
| HumanEval+ (first 20) | 20 | codder/claude-sonnet-5-5 | **20/20 (100%)** | 14.7 s (median 13.5) | $0.3631 |
| Polyglot python | 9* | codder/claude-sonnet-5-5 | **9/9 (100%)** | 47.4 s (median 47.1) | $1.3104 |

\* budget-capped before task 10; N is attempted tasks only.

Per-task JSON: `runs/external-*.json` (committed). Raw run logs (redacted):
`/tmp/ra-parity/wave5-logs/`.

## Failure taxonomy

Final scored runs: **zero model failures** — no syntax errors, no wrong-logic,
no timeouts, no harness misses. The taxonomy machinery was exercised anyway:

- Earlier run (discarded, HE+/12–19): 8 tasks failed as `error → harness
  "solution.py missing/empty"` — root cause was an upstream Codder outage
  (`503 system cpu overloaded 99%+`), not the model. That entire report was
  deleted and re-run after recovery. This is the same 503/overload endpoint
  flakiness Wave 3b documented; budget caps + re-run discipline handle it.
- Unit tests (`ra/tests/bench-external.test.ts`) pin all four failure buckets
  (syntax / wrong-logic / timeout / harness) with fixture tasks.

## Honest caveats

1. **First-attempt-only**: Aider's official polyglot protocol gives the model
   two attempts (test feedback shown after attempt 1). Our harness allows one —
   so 9/9 here is not directly comparable to Aider leaderboard "%" (theirs can
   only be ≥ ours on the same model).
2. **Slice selection**: first-20 (HumanEval+) / alphabetical-first-10
   (polyglot) — not a random sample; fine for smoke-level pass@1, not a
   leaderboard claim.
3. **Codder pricing** comes from the provider block in `ra-codder.json`
   (sonnet $3/$15 per M) — actual billing is whatever Codder does; treat costs
   as estimates.
4. **Sandbox**: verifier runs are plain subprocesses, not OS-level sandboxes —
   same trust posture as `ra eval` (trusted benchmark data + own machine).
5. **py3.9 verifier**: HumanEval+ canonical solutions target ≥3.10 in places
   (e.g. /15's perf-heavy tests are fine, but any solution using 3.10+ syntax
   would fail as `syntax` — a verifier-environment artifact; none hit in these
   20 tasks).
6. **MBPP+ adapter** exists and is tested offline, but was not run live —
   spend went to the edit-style suite instead (more signal diversity).

## Reproduce

```bash
source /tmp/ra-e2e/env-codder-sonnet.sh && export RA_LOCAL_ONLY=1
bun ra/src/cli.ts bench external humanevalplus --model codder/claude-sonnet-5-5 --limit 20 --budget 2 --cwd benchmarks
bun ra/src/cli.ts bench external polyglot-py   --model codder/claude-sonnet-5-5 --limit 10 --budget 1.2 --cwd benchmarks
```
