# RA — Status

> Current cycle plan, last cycle result, smoke-test table, known capability limits per model.
> Read-then-update every cycle.

## Current Cycle

**Cycle 21 — Session reattach summary (P1).** Plan: add `formatReattach` to `session.ts`, show a reattach summary in the TUI when a session has prior messages, add test. Files: `ra/src/server/session.ts`, `ra/src/tui/app.ts`, `ra/tests/session.test.ts`.

## Last Cycle Result

**Cycle 20 — LM Studio/llama.cpp auto-discovery shipped.** Added `fromOpenAI` + `discoverLocalOpenAI` (last-resort small-model fallback); 3 tests. Full gate green.

## Smoke-Test Table

| Date | Model | Host | Task | Latency | Pass/Fail | Notes |
|------|-------|------|------|---------|-----------|-------|
| 2026-08-22 | glm-5.2 | @cloud (Ollama Cloud) | fix-bug hello.py | ~1.8s/stage | ✅ PASS | full-dev pipeline thoth→ptah |
| 2026-08-22 | qwen3.8:latest | @251 (LAN) | fix-bug hello.py (plan) | — | ✅ PASS | thoth plan stage |
| 2026-08-22 | qwen3.8:latest | @251 (LAN) | chat completion | 28.6s | ✅ PASS | integration test |
| 2026-08-22 | glm-5.2 + qwen3.8 | @cloud + @251 | hello-world CLI (full-dev) | 39.2s | ✅ PASS | wrote hello.py, ran → "Hello, World!" |
| 2026-08-22 | qwen3.8:latest | @251 (LAN) | list+summarize (reduced probe) | ~2s | ✅ PASS | correct file/purpose table |
| 2026-08-22 | gemma:latest + glm-5.2 | @local + @cloud | hello-world CLI (fallback chain) | 16.9s | ✅ PASS | .251 down → thoth fell back to gemma@local, ptah used glm-5.2@cloud |

## Model Capability Matrix

| Model | Host | Role | Capability | Limits |
|-------|------|------|------------|--------|
| qwen3.8:latest | @251 LAN | thoth (plan), small | Plan, chat, code-gen | Local 8B — use for plan/meta, not heavy code |
| gemma:latest | @local fallback | maat/sekhmet/seshat/horus | Review, docs, fast tasks | Weakest — reduced probes only |
| glm-5.2 | @cloud (Ollama Cloud) | ptah (code), BIG | Full code-gen | Requires `OLLAMA_API_KEY` |

## Known Capability Limits

- **gemma (localhost)** — too weak for full code tasks; use for review/docs/reduced probes only.
- **qwen3.8 (.251)** — good for planning and moderate code; heavy implementation routed to cloud glm-5.2.
- **No daemon** — sessions persist to disk but there is no background server yet (P1 gap).

## Environment

- **Stack:** TypeScript + Bun 1.3.14
- **Repo:** `/Users/zari/Desktop/PROJETOS MAC/RA`
- **Core:** `anubis/` (engine) + `ra/` (runtime/TUI)
- **Test:** `./test.sh` (full gate) / `bun test` (unit)
- **Cloud:** Ollama Cloud (`OLLAMA_API_KEY` set in `anubis/.env`)
- **Local:** Ollama @ `192.168.1.251` (qwen3.8) + `localhost` (gemma fallback)
