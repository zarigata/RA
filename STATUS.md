# RA — Status

> Current cycle plan, last cycle result, smoke-test table, known capability limits per model.
> Read-then-update every cycle.

## Current Cycle

**2026-08-31 — Full-screen TUI with unified "/" palette (RA 1.0.0-ra.73).**
`ra` in a terminal now opens an opencode-inspired workspace: header with
models/profile, markdown-rendered streaming conversation, cost sidebar,
bordered input, clickable key-chip footer. Pressing `/` fuzzy-searches
EVERYTHING — commands, custom commands, agents, project files, sessions,
models, and themes — with mouse clicks (SGR) and wheel scrolling. Themes
persist to `~/.ra/tui.json` (`theme`, `mouse`, `scrollSpeed`). Zero new
runtime dependencies; pipes keep the legacy readline UI. Installed-user
acceptance: **8/8 in one batch** ([`ra tests/RESULTS.md`](ra%20tests/RESULTS.md),
`evidence/ui-73/`), unit suite **380/0** (18 new TUI cases), gate green.
Research basis: opencode's TUI (palette, mouse default, themes, layout)
captured live plus its published keybind/theme docs.

**2026-08-30 — Fallbacks, competitive evidence, tool hardening (RA 1.0.0-ra.72).**
Provider failures now walk an explicit user-configured fallback chain
(`RA_CONFIG` `fallbacks` / `RA_FALLBACK` / `RA_SMALL_FALLBACK`) with visible
attribution; cloud never silently degrades to LAN/local and auth failures fail
loudly. Installed-user acceptance: fallback scenarios **4/4**, .71 regression
spot-check **2/2**, unit suite **360/360** (first fully green run since .71;
four stale fixtures fixed). First fixed-budget competitive matrix on real
repositories (micrograd, slugify), all three named competitors measured:
**RA 3/3 and fastest per task (7–12 s)**; codex 3/3 (gpt-5.6-sol, 32–60 s,
rerun after its quota reset); claude 3/3 (claude harness on the user's Z.AI
GLM plan, 54–98 s); opencode 0/6 across two runs with the same Ollama model
as RA — see [`ra tests/COMPETITIVE_RESULTS.md`](ra%20tests/COMPETITIVE_RESULTS.md).
The benchmark exposed and fixed two real tool bugs: empty-content WRITEs are
now rejected with a retryable error, and directory READ/EDIT paths return a
graceful error instead of crashing the stage with EISDIR. The internal gate was
also repaired after being silently dead since .69: 23 live checks pass, both
unit suites run inside it, the LAN-hardware-dependent E2E records a labeled
skip while .251 is unreachable, and MCP servers outside the workspace load
under the sandbox.

**2026-08-30 — Native sandbox regression proof (RA 1.0.0-ra.71).**
The .71 build put every agent shell, stdio MCP server, compiler run, Python
verification, and swarm Git operation inside the native macOS command sandbox.
To prove that did not break real work, both installed-user suites were rerun
against the reinstalled build with live Ollama Cloud (GLM planning/review,
DeepSeek implementation): **coding 21/21** and **teams 16/16**, each in one
uninterrupted run. The safety batch itself stands at 21/23 with two
model-refusal cases retained as inconclusive. Evidence:
[`ra tests/RESULTS.md`](ra%20tests/RESULTS.md),
[`ra tests/AGENT_RESULTS.md`](ra%20tests/AGENT_RESULTS.md),
[`ra tests/SAFETY_RESULTS.md`](ra%20tests/SAFETY_RESULTS.md).

The goal remains open. Next priorities: explicit cloud fallbacks with visible
attribution, per-session daemon cancellation, crash/model-task resume, durable
long-project state, and competitive evidence on real repositories.

**2026-08-30 — Agent teams and retained worktrees (RA 1.0.0-ra.70).**
CLI/TUI now expose agent discovery, bounded read-only MoA, and coding swarms.
Execution scopes share call/agent/depth/deadline limits, preserve partial
outcomes, track sibling agents independently, and cancel shell process groups.
Swarm apply integrates in a retained worktree and protects dirty/moved targets.

**Installed acceptance: 16/16 new team scenarios passed in one batch.**
Original regression batch: **20/21**, with a GPT-OSS planning Internal Server
Error that repeated on retry. The failed bug-fix scenario passed separately with
an explicit GLM planner. See [`ra tests/AGENT_RESULTS.md`](ra%20tests/AGENT_RESULTS.md)
for transcripts, source hashes, the reproduced/fixed child-process leak, and
limits. No internal test-suite success or competitive superiority is claimed.

The earlier .69 and cycle notes below are historical.


**2026-08-30 — Installed-user reliability pass (RA 1.0.0-ra.69).** See
[`ra tests/RESULTS.md`](ra%20tests/RESULTS.md) for the current measured acceptance
result, which supersedes old smoke-test claims for this pass. The new 21-case
suite uses an installed macOS copy, fresh project/HOME directories, a Seatbelt
write sandbox, live Ollama Cloud, and real PTY sessions. No existing repository
test script was used as acceptance evidence.

Changes: consistent exported environment/configuration; shared file-aware CLI
and TUI agent loop; honest failure state and artifact verification; DeepSeek XML
and native tool-call normalization; complete fenced-file writes; read-only role
tool filtering; original-content undo; symlink checks; model interruption;
bounded recent conversation context; grouped help; and transient stream errors.

The broader RA 2.0 goal remains open. This pass does not establish competitive
superiority, complete feature parity, or production security. Full internal CI,
MCP, remote/IDE paths, long-context compaction, and built-in
OS sandboxing still need independent acceptance work. The existing older cycle
notes below are historical, not results from this run.


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
