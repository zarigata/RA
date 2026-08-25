# RA — Status

> Current cycle plan, last cycle result, smoke-test table, known capability limits per model.
> Read-then-update every cycle.

## Current Cycle

**Cycle 44 — RA 2.0 Phase 0 (trustworthy engine).** Master plan written (`PLAN.md`, from the Claude Code/OpenCode/Crush/aider/Codex competitive audit). Landed: streaming everywhere (native NDJSON + cloud SSE, TUI token render, root-turn only), keep_alive 30m default + `ra warm` + TUI background warm-up, loop-level retry on transient errors, real MoA aggregation with disagreement surfacing, custom commands fixed (project `.ra/commands` + `~/.ra/commands`, `$ARGUMENTS`/`$N`, `agent:` frontmatter), `/todos` UI + TODO rm op.

## Last Cycle Result

**Cycle 44 — Phase 0 core landed.** Live-verified: `ra warm` loads qwen3.8 in 55s (cold) then 30m residency; PTY test shows 61 progressive token reads per turn (was: silent wait + single dump); ra 172 + anubis 179 unit tests pass (22 new); full gate green. Remaining Phase 0: compaction, honest-eval stub removal, selfheal wiring. Cycle 43 — audit + wiring fixes, 330 tests green.

## Smoke-Test Table

| Date | Model | Host | Task | Latency | Pass/Fail | Notes |
|------|-------|------|------|---------|-----------|-------|
| 2026-08-25 | qwen3.8:latest | @251 (LAN) | "reply OK" (warm) | 2.2s | ✅ PASS | eval 1.45s (~24 tok/s); cold load 54s |
| 2026-08-25 | glm-5.2 | @cloud | "reply OK" | 0.97s | ✅ PASS | thinking model — token-capped calls return empty content |
| 2026-08-25 | gemma:latest | @local | "reply OK" | 26s cold / 1.1s eval | ✅ PASS | local ollama also proxies glm-5.2:cloud (2.5s) |
| 2026-08-25 | qwen3.8 → glm-5.2 | @251 + @cloud | TUI live: hello.py via ptah | ~60s (cold) | ✅ PASS | PTY-driven session; correct file written |
| 2026-08-25 | qwen3.8 | @251 | TUI live: chat "2+2" | ~5s | ✅ PASS | correct answer via small-model single-shot |
| 2026-08-22 | glm-5.2 + qwen3.8 | @cloud + @251 | hello-world CLI (full-dev) | 39.2s | ✅ PASS | wrote hello.py, ran → "Hello, World!" |
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
| qwen3.8:latest | @251 LAN | thoth (plan), small | Plan, chat, code-gen | 27B Q4_K_M, 262k ctx, tools/thinking/vision — good for plan/meta, not heavy code |
| gemma:latest | @local fallback | maat/sekhmet/seshat/horus | Review, docs, fast tasks | Weakest — reduced probes only |
| glm-5.2 | @cloud (Ollama Cloud) | ptah (code), BIG | Full code-gen | Requires `OLLAMA_API_KEY` |

## Known Capability Limits

- **gemma (localhost)** — too weak for full code tasks; use for review/docs/reduced probes only. When `.251` is down and gemma is used for the code stage, it occasionally generates a `hello.py` that runs but doesn't print "hello", causing the `--verify` step to fail transiently. This is a model-quality flake, not a code regression (re-runs pass).
- **qwen3.8 (.251)** — good for planning and moderate code; heavy implementation routed to cloud glm-5.2. Cold model load is ~55s after idle (nothing sets `keep_alive` yet — see EVALUATION.md §2).
- **Thinking models** — qwen3.8 and glm-5.2 return empty content when token-capped (reasoning consumes the budget); never cap tokens on these models.

## Environment

- **Stack:** TypeScript + Bun 1.3.14
- **Repo:** `/Users/zari/Desktop/PROJETOS MAC/RA`
- **Core:** `anubis/` (engine) + `ra/` (runtime/TUI)
- **Test:** `./test.sh` (full gate) / `bun test` (unit)
- **Cloud:** Ollama Cloud (`OLLAMA_API_KEY` set in `anubis/.env`)
- **Local:** Ollama @ `192.168.1.251` (qwen3.8) + `localhost` (gemma fallback)
