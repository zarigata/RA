# RA — Status

> Current cycle plan, last cycle result, smoke-test table, known capability limits per model.
> Read-then-update every cycle.

## Current Cycle

**Cycle 42 — Final cleanup and hardening.** Plan: wire global hooks to PluginHost, fix LspClient error handling, wire getActiveSession to TUI, add createSubagentTracker test, update gate to include new test files. Files: `ra/src/tui/app.ts`, `ra/src/diagnostics.ts`, `ra/tests/tree.test.ts`, `anubis/test.sh`.

## Last Cycle Result

**Cycle 42 — Cleanup complete.** Global agent hooks bridged to PluginHost. LspClient error handling for missing binaries. Active session pointer wired to TUI startup. Gate script updated with 3 new test files. All 321 tests pass (169 anubis + 152 ra). Full gate green. Build clean.

## Smoke-Test Table

| Date | Model | Host | Task | Latency | Pass/Fail | Notes |
|------|-------|------|------|---------|-----------|-------|
| 2026-08-22 | glm-5.2 | @cloud (Ollama Cloud) | fix-bug hello.py | ~1.8s/stage | ✅ PASS | full-dev pipeline thoth→ptah |
| 2026-08-22 | qwen3.8:latest | @251 (LAN) | fix-bug hello.py (plan) | — | ✅ PASS | thoth plan stage |
| 2026-08-22 | qwen3.8:latest | @251 (LAN) | chat completion | 28.6s | ✅ PASS | integration test |
| 2026-08-22 | glm-5.2 + qwen3.8 | @cloud + @251 | hello-world CLI (full-dev) | 39.2s | ✅ PASS | wrote hello.py, ran → "Hello, World!" |
| 2026-08-22 | qwen3.8:latest | @251 (LAN) | list+summarize (reduced probe) | ~2s | ✅ PASS | correct file/purpose table |
| 2026-08-22 | gemma:latest + glm-5.2 | @local + @cloud | hello-world CLI (fallback chain) | 16.9s | ✅ PASS | .251 down → thoth fell back to gemma@local, ptah used glm-5.2@cloud |

## Eval Harness Results (2026-08-23)

| Model | hello-function | sum-function | html-page | Pass rate |
|-------|----------------|--------------|-----------|-----------|
| ollama-cloud/glm-5.2 | ✗ | ✗ | ✓ | 1/3 (33%) |
| ollama-lan/qwen3.8:latest | ✗ | ✗ | ✓ | 1/3 (33%) |

Note: eval harness now has 21 tasks (expanded from 3). The 3 seed tasks above show
the baseline; full 21-task runs will be done as a follow-up with the live models.
The `hello-function`/`sum-function` tasks still fail intermittently because the
small/cloud models don't reliably emit the exact requested function shape in a
single pass — a genuine model-capability limit, not a code regression.

## Model Capability Matrix

| Model | Host | Role | Capability | Limits |
|-------|------|------|------------|--------|
| qwen3.8:latest | @251 LAN | thoth (plan), small | Plan, chat, code-gen | Local 8B — use for plan/meta, not heavy code |
| gemma:latest | @local fallback | maat/sekhmet/seshat/horus | Review, docs, fast tasks | Weakest — reduced probes only |
| glm-5.2 | @cloud (Ollama Cloud) | ptah (code), BIG | Full code-gen | Requires `OLLAMA_API_KEY` |

## Known Capability Limits

- **gemma (localhost)** — too weak for full code tasks; use for review/docs/reduced probes only. When `.251` is down and gemma is used for the code stage, it occasionally generates a `hello.py` that runs but doesn't print "hello", causing the `--verify` step to fail transiently. This is a model-quality flake, not a code regression (re-runs pass).
- **qwen3.8 (.251)** — good for planning and moderate code; heavy implementation routed to cloud glm-5.2.
- **No daemon** — sessions persist to disk but there is no background server yet (P1 gap).

## Environment

- **Stack:** TypeScript + Bun 1.3.14
- **Repo:** `/Users/zari/Desktop/PROJETOS MAC/RA`
- **Core:** `anubis/` (engine) + `ra/` (runtime/TUI)
- **Test:** `./test.sh` (full gate) / `bun test` (unit)
- **Cloud:** Ollama Cloud (`OLLAMA_API_KEY` set in `anubis/.env`)
- **Local:** Ollama @ `192.168.1.251` (qwen3.8) + `localhost` (gemma fallback)
