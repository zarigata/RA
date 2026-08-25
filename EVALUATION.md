# RA System Evaluation — 2026-08-25

Independent audit by GLM-5.3 (edge-computing pass): architecture, endpoints,
tests, agents, prompts, TUI/UX vs OpenCode, and a prioritized roadmap.
All findings below were verified against source (`file:line` cited) or
reproduced live against the real endpoints during this session.

---

## 0. TL;DR verdict

**RA is a working, end-to-end terminal coding agent with a genuinely good
bones**: correct LAN-first/cloud-second topology, a clean tool grammar that
small models can actually follow, checkpointed/permissioned file tools, an
honest eval harness, and 300+ passing tests including live E2E. The live
session proved the full loop works: a plain-English "create hello.py" in the
TUI produced a correct file through the ptah agent via the real model chain.

**What holds it back from "great"** is polish and wiring, not architecture:

1. **Wiring gaps** — features built but not connected (MCP tools never reach
   the model, subagent tree never populated, frontmatter model override inert,
   nested permission maps unparsed, LSP client uncalled).
2. **Latency perception** — cold model load on `.251` is ~55s and nothing
   mitigates it (no keep-alive, no warm-up, no progress feedback during waits).
3. **TUI is a REPL, not a TUI** — no mouse, no alt-screen, no editor, no
   markdown rendering; Ctrl+C says "use /exit" then quits anyway (bug).
4. **Cost tracking counts tokens but prices nothing** ($0.0000 everywhere).
5. One security item (leaked API key) — **already fixed this session; rotate
   the key at ollama.com to finish the remediation.**

---

## 1. Architecture map

```
┌──────────────────────────── ra/ (runtime) ────────────────────────────┐
│ TUI (tui/app.ts, readline+ANSI) ── /commands (commands/index.ts)      │
│   │  non-slash input → runOrchestratorTurn (agent.ts:356)             │
│   ▼                    slash /plan /code → runTaskAgent(role)         │
│ Agent loop (agent.ts:276 runTaskAgent)                                │
│   system = persona .md + AGENTS.md memory + TOOL_HINT (agent.ts:298)  │
│   ▼                                                                    │
│ Tool grammar parser (execToolBlock agent.ts:160) — regex over text    │
│   WRITE/EDIT/MULTIEDIT/READ/OUTLINE/DIAGNOSE/GLOB/GREP/BASH/WEBFETCH/ │
│   TODO/TASK(role)/DONE → tools/index.ts (safePath, redact, checkpoint)│
│   ▼                                                                    │
│ Daemon/sessions (server/*: JSON store ~/.ra/sessions, replay, remote) │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ imports (relative)
┌──────────────────────────── anubis/ (engine) ─────────────────────────┐
│ ollama.ts — endpoint probe (.251 → localhost), fallback chains,       │
│   native /api/chat + cloud /v1/chat/completions clients               │
│ router.ts (role→model), runner.ts (thoth→ptah pipeline), cost.ts,     │
│ config.ts (ra.json profiles), personas in .anubis/agents/*.md         │
└──────────────────────────────┬─────────────────────────────────────────┘
                               ▼
   small: qwen3.8:latest @ 192.168.1.251:11434   BIG: glm-5.2 @ ollama.com/v1
   fallback: gemma:latest @ localhost:11434 (local ollama = cloud proxy)
```

**Verdict**: the two-package split is unusual (ra↔anubis via relative imports,
no workspace linkage — D-002) but coherent: engine vs runtime. It costs you
IDE-navigation friction and makes `ra` unrunnable without the sibling tree;
fine for a personal tool, worth a workspace/`package.json` link later.

---

## 2. Endpoint & environment health (measured this session)

| Endpoint | Status | Latency | Notes |
|---|---|---|---|
| `.251` `/api/tags` | ✅ up | 19–33 ms | 5 models: qwen3.8 (27.3B Q4_K_M, 262k ctx, caps: completion/tools/thinking/vision), gpt-oss:20b, gpt-oss:latest, gemma4:12b, bge-m3 (embeddings) |
| `.251` qwen3.8 chat (warm) | ✅ | **2.2 s** total, 1.45 s eval (24 tok/s) | healthy once loaded |
| `.251` qwen3.8 chat (cold) | ✅ | **54.8 s** (54.2 s = model load) | ollama unloads after idle; nothing in RA sets `keep_alive` or warns the user |
| Ollama Cloud `/v1/models` | ✅ key valid | 158–518 ms | 19 models incl. glm-5.2, kimi-k2.7-code, gpt-oss:120b, deepseek-v4-pro, qwen3.5:397b |
| Cloud glm-5.2 chat | ✅ | 0.97 s | thinking model — see gotcha below |
| localhost:11434 | ✅ **surprise: alive** | 5–7 ms | a real local `ollama` (PID 833) acting as **cloud proxy**: serves `glm-5.2:cloud`, `minimax-m3:cloud`, plus local `gemma:latest` 9B |
| localhost gemma chat | ✅ | cold 26 s / eval 1.1 s | works as the emergency fallback leg |

Findings:

- **The "no local ollama" assumption is half-wrong.** A local ollama daemon is
  running as a cloud-model proxy. This is actually a *feature* (cloud access
  even if ollama.com direct route fails) — but it's invisible to `ra` config
  (no provider for `localhost glm-5.2:cloud`) and undocumented. Either adopt
  it as an explicit provider or note it.
- **Thinking-model gotcha (both lanes).** qwen3.8 and glm-5.2 put reasoning in
  a separate `thinking`/reasoning channel. With any token cap, visible content
  comes back **empty** (`max_tokens:20` on glm-5.2 → `content: ""`). The agent
  loop sets no caps so it mostly works, but `ra.json` has no
  `reasoning`/`think` switches, thinking tokens are invisible to cost
  accounting, and eval tasks with tight verification can see empty outputs.
- **Cold-load dominates perceived latency.** `ra status` shows the last real
  task: thoth@251 **60.3 s** vs ptah@cloud 1.8 s. That 60 s is model load, not
  inference. Mitigations: `keep_alive` tuning, a `ra warm` command, background
  warm-up on TUI start, and progress spinner during first turn.
- **Cost tracking prices nothing**: `ra cost` reports 1.5M tokens and
  `$0.000000`. Token counting works; the price table is empty/zero. Cloud
  spend is therefore invisible — add per-model pricing (even rough) to
  `estimateCost`.

---

## 3. Test suite status

**Full gate run 2026-08-25 (this session, live `.251` + cloud): `./test.sh` →
321 pass / 0 fail / exit 0** — unit (anubis + ra), routing, doctor/ping,
selfcheck, TUI E2E pipes, full-dev runs (thoth@251 → ptah@cloud produced a
verified working `hello.py`), `ra again --verify` (exit 0, "Hello, World!"),
and `benchmark run all` (smoke + cookie + todo + fix-bug all PASSED).
STATUS.md's "all 321 tests pass" claim is accurate.

Notable live timings from the gate: full-dev 7.6–10.9 s end-to-end when the
`.251` model is warm (vs 60 s+ cold), confirming §2's cold-load analysis.

Flakiness inventory (static analysis + live observation):

| Risk | Where | Impact |
|---|---|---|
| Real internet fetch | `ra/tests/runtime.test.ts` (example.com) | fails offline/CI |
| Fixed ports 4318/4319 | `daemon.test.ts`, `remote.test.ts` | collisions on parallel runs |
| Writes to real `~/.ra` | `session.test.ts`, `replay.test.ts` | clobbers developer state; unsafe in parallel |
| External binaries | git (swarm), python3 (diagnostics), bun (mcp fixture) | environment-dependent |
| Module-load network probes | anubis `backtest.test.ts` skip-check | probes .251/localhost even when skipping |
| Live-model asserts in gate | test.sh E2E (`hello.py` prints hello) | model-dependent flake (documented in STATUS) |

Coverage gaps: `ra/src/doctor.ts`, `ra/src/tui/app.ts`, `ra/src/cli.ts` have no
unit tests (only E2E pipes). CI runs a ~28-file subset and points
`OLLAMA_LAN_URL` at localhost where no ollama exists (cloud leg only — should
be explicit).

---

## 4. Agent & prompt audit

### 4.1 The three prompt layers

1. **Personas** — `anubis/.anubis/agents/*.md` (11 files): 8 roles
   (anubis orchestrator, thoth plan, ptah code, maat diagnose, sekhmet
   critique, isis research, seshat docs, horus quick) + 3 new subagents
   (general/explore/scout). Good separation of concerns; frontmatter carries
   steps/temperature/permissions (and now model/tools).
2. **Project memory** — `AGENTS.md`/`RA.md` from cwd injected after the
   persona (`agent.ts:149`). Right idea, minimal but correct.
3. **`TOOL_HINT`** (`agent.ts:36-74`) — the plain-text tool grammar appended
   to every system prompt.

### 4.2 What's good

- **The plain-text tool grammar is the right call for small models.** qwen3.8
  at 27B follows `WRITE path` + fence + `DONE` reliably (proven live: correct
  hello.py first try). JSON-schema function-calling would likely be *worse* on
  this hardware tier. Keep the grammar; formalize it (see roadmap).
- Persona hygiene: read-only roles (thoth/maat) deny edit/bash; per-role
  steps/temperature are sensible (plan 0.1/code 0.2).
- Honest orchestration rules in anubis.md ("Never claim a role did work it
  did not do", "report which models ran").
- Tool layer is defensive: `safePath` jail, secret redaction on I/O,
  checkpoints before every write, 60s bash timeout.

### 4.3 Wiring bugs (verified in source)

| # | Bug | Where | Effect |
|---|---|---|---|
| W1 | Frontmatter `model:` override applied **after** client resolution | `agent.ts:291` picks client, `:297` reassigns `configured` (never used again) | per-agent model override silently ignored |
| W2 | MCP tools never wired into the loop | `mcp.ts` implements clients; only tests call `loadMcpTools`/`searchMcpTools` | 400 lines of MCP (stdio+HTTP+OAuth) the model can't see |
| W3 | `TOOL_HINT` static | `agent.ts:36` | never lists MCP tools, ignores per-agent `tools:` frontmatter (parsed at `:141`, never enforced) |
| W4 | Nested bash permission maps unparsed | `maat.md`/`sekhmet.md` use `bash: {"*": ask, "git diff*": allow}`; parser regex only reads flat `tool: allow` (`agent.ts:102`) | maat/sekhmet run with *no* agent permissions — fall through to global config only |
| W5 | Subagent tree never populated | `agent.ts:307` spawns recursively without tracker; `/tree` reads `_subagentTree` that nothing sets (`tui/app.ts:192`, `commands/index.ts`) | the Cycle-42 tree panel renders nothing in practice |
| W6 | LSP client uncalled | `diagnostics.ts:88-268` `LspClient` + `BUILTIN_LSP_SERVERS` | dead code path; DIAGNOSE still shells out to tsc/py_compile |
| W7 | Hardcoded demo fallbacks in production path | `agent.ts:335-337, 382-403` (todo/cookie/hello index.html), `runner.ts:18-24` ("never recurse" nudges) | benchmark-shaped guardrails write files the model never wrote; mask real model failures |
| W8 | `runOrchestratorTurn` routes by verb regex | `agent.ts:369` (`create|write|make|build|implement|add`) | "add a comment about X" wrongly enters the ptah tool loop; plain questions containing verbs get file tools |
| W9 | No retry at the loop level | `agent.ts:312` `nativeChat` direct; `runWithFallback` exists (`ollama.ts:378`) but unused here | one transient 5xx/timeouts bubble straight to the user |
| W10 | Ctrl+C quits despite refusal message | `tui/app.ts:135` prints "Use /exit or Ctrl+D", but readline (no `SIGINT` listener) closes the interface → process exits 0 | reproduced live, twice |
| W11 | Cost always $0 | `cost.ts` price table has no entries for these models | see §2 |

### 4.4 Prompt quality notes

- `ptah.md` is 5 lines and doesn't know about the project's real conventions —
  fine — but it also never tells the agent **how to verify** beyond "run tests"
  (DIAGNOUSE exists; one sentence would wire behavior to it).
- `TOOL_HINT` says "one at a time" — good for reliability, slow for
  throughput. A `MULTITOOL`/batched-fence variant is a measured next step.
- `runOrchestratorTurn`'s non-coding branch string-replaces "Anubis"→"RA"
  (`agent.ts:409`) — fragile branding shim; the persona file should just say RA.
- Custom slash commands (`~/.anubis/commands/*.md`) execute their body through
  the *anubis* persona regardless of content — no way to pick role/model per
  command (frontmatter extension is cheap).
- No context compaction: sessions cap at 200 messages (`session.ts:33`);
  long tasks will blow context with no summarization step. All three
  personable fixes live in the roadmap.

---

## 5. TUI/UX evaluation vs OpenCode

Live-session evidence (PTY-driven, real keystrokes into a real terminal, plus
a Terminal.app window screenshot): splash, welcome, reattach banner, `/help`,
`/ping` (live endpoints), palette open/toggle/select-by-number, small-model
chat turn (correct "4"), ptah coding turn (correct `hello.py`), cost sidebar,
`/sessions`, clean Ctrl+D exit — all PASS. Ctrl+C bug reproduced (W10).

### 5.1 Scorecard

| Capability | OpenCode | RA today | Verdict |
|---|---|---|---|
| Mouse support (click palette, scroll) | ✅ | ❌ | **missing** — RA never emits `?1000h/?1006h` mouse-enable sequences (verified by byte-level capture); clicks physically cannot reach the app |
| Full-screen alt-buffer UI | ✅ | ❌ | scrollback REPL; no `?1049h`, no cursor control |
| Command palette | fuzzy filter + arrows | number-key only | partial — works (verified) but 33 items means typing "24" |
| `/` commands | ✅ rich | ✅ 35+ commands | **have** — broad set, custom commands from md files |
| Keybinds | ✅ | partial | one default (Ctrl+P), config map exists (`config.keybinds`) |
| Multi-line input / `$EDITOR` | ✅ | ❌ | readline single-line only |
| Markdown + syntax highlight rendering | ✅ | ❌ | raw text + ANSI colors |
| Streaming tokens | ✅ | ❌ | `stream:false` everywhere; user stares at silence for 60s cold loads |
| Interrupt a running turn | ✅ | ❌ | W10: Ctrl+C kills the whole app mid-turn |
| Session resume / attach | ✅ | ✅ | reattach banner + `ra daemon --remote` (Cycle 42) — genuinely good |
| Undo/checkpoints | partial | ✅ | `ra undo/diff` per-file snapshots — ahead of many tools |
| Onboarding | ✅ | ✅ | welcome hints, `/simple on` "grandma mode" — charming and effective |
| Cost/context display | ✅ | partial | sidebar exists but $0 (W11); no context-window gauge |
| Themes | ✅ | partial | Pharaonic default, config override exists |

### 5.2 UX verdict

RA today is **"a very good REPL with agent superpowers"**, not yet an
OpenCode-class TUI. The interaction model users expect in 2026 — full-screen,
mouse, fuzzy palette, streaming, interruptible — is absent because the TUI is
`node:readline` + ANSI. That was a rational choice for zero dependencies, but
it's now the ceiling. The realistic path is incremental: fix Ctrl+C, add
arrow-key/fuzzy palette, spinner during turns, streaming via `/api/chat`
stream mode — all doable in readline. Mouse + alt-screen + markdown needs a
real TUI layer (ink/blessed or a Go-style rewrite); schedule it as its own
project, don't bolt it on.

---

## 6. Security findings

| Finding | Severity | Status |
|---|---|---|
| `OLLAMA.rtf` git-tracked with live `OLLAMA_API_KEY` | **critical** | ✅ fixed this session: file deleted, purged from all 46 commits (verified byte-level), second copy in `redact.test.ts` replaced with synthetic token |
| Key rotation | required | ⚠️ **user action**: rotate at ollama.com to permanently invalidate the exposed key |
| `anubis/.env` gitignored | ok | verified ignored; key never printed to logs by ra tooling |
| vibeguard redaction on bash/read/write I/O | good | `redact.ts` covers OpenAI/Anthropic/AWS/GitHub/Ollama token shapes; restore-stash round-trips |
| `safePath` cwd jail on file tools | good | blocks `..` escapes (`tools/index.ts:13-20`) |
| Daemon binds `0.0.0.0:8080` by default | medium | fine behind the documented reverse-proxy story; note it's reachable on LAN — consider `127.0.0.1` default + opt-in |

---

## 7. Model capability findings (eval harness evidence)

- STATUS.md records eval runs: **glm-5.2 and qwen3.8 both pass ~1/3 of seed
  tasks** — the bottleneck is model capability on one-shot codegen, not the
  harness. The 22-task expansion (Cycle 42) is the right instrument; run it
  per-model before/after any prompt change.
- qwen3.8 advertises `tools` capability natively — ollama would do structured
  tool-calling for it. Worth an A/B: TOOL_HINT grammar (current) vs native
  tools on the same eval tasks; keep whichever passes more.
- gpt-oss:20b sits unused on `.251` — a free A/B candidate for the code tier.
- Cloud has kimi-k2.7-code / gpt-oss:120b / deepseek-v4-pro — the eval
  harness already supports `agent.ptah.model` overrides; a
  `ra eval --model X` sweep would find the best BIG for ptah.

---

## 8. Prioritized roadmap

### P0 — correctness & trust (do first)
1. Fix W1 (model override), W4 (nested perms), W10 (Ctrl+C) — small diffs.
2. Cost pricing table (W11) — even rough $/M estimates for qwen/glm/gemma.
3. Key rotation (user) + keep `anubis/.env` out of any future remote.

### P1 — make it feel fast (the "vibe" work)
4. `keep_alive` + TUI-start warm-up ping + `ra warm`; spinner during turns.
5. Streaming (`/api/chat` stream, cloud SSE) — kills the 60s-dead-air problem.
6. Retry/fallback at the loop level (use the existing `runWithFallback`).
7. Context compaction (summarize when > N chars; 200-msg cap is not enough).

### P2 — finish what's built
8. Wire MCP tools into TOOL_HINT + execToolBlock (W2/W3); enforce `tools:`.
9. Wire subagent tree (W5); LSP into DIAGNOSE with tsc fallback (W6).
10. Delete hardcoded demo fallbacks (W7); route via tier/intent, not verb
    regex (W8); ptah persona: add verify-with-DIAGNOSE line.
11. TUI: arrow-key+fuzzy palette, multi-line input (brace paste), `$EDITOR`
    compose, interrupt-turn (Ctrl+C during turn = cancel, not exit).

### P3 — the OpenCode-class leap
12. Real TUI layer (ink or blessed): alt-screen, mouse, markdown render,
    per-message model badges, scrollable transcript.
13. Native tool-calling A/B on qwen3.8/gpt-oss (eval-gated).
14. Workspaces/npm linkage for ra↔anubis; adopt the local cloud proxy as an
    explicit provider.

---

## 9. Changes made in this audit (Cycle 43)

- Security: key leak fixed (file + full history purge + test fixture swap).
  **Still requires: key rotation at ollama.com.**
- Hygiene: 122 MB dead `node_modules` removed; stale 2026-08-15 docs archived;
  `INDEX.md` regenerated; `.zcode/` ignored.
- Baseline: Cycle-42 WIP committed in 4 thematic commits (was 24 dirty files).
- This document + live-test evidence (PTY logs, endpoint measurements,
  Terminal.app screenshot).
- **Wiring fixes landed and verified live**: W1 (model override now applied
  before client pick), W2+W3 (MCP tools connected, advertised in a dynamic
  `buildToolHint` that also honors `tools:` whitelists, new `MCP` grammar
  verb), W4 (nested bash permission maps parse + glob-rule enforcement),
  W5 (subagent tree tracked and rendered — verified in a live session),
  W10 (Ctrl+C keeps the TUI alive — reproduced before, verified after),
  W11 (cost display annotates subscription-covered cloud models).
- Config hygiene: legacy `anubis.json` aligned with `.251` reality; CI
  localhost fallback documented.
- Tests: +9 unit tests (161 ra now); full gate re-run green (330 total).
- **Still on the roadmap** (not fixed this pass): W6 (LSP into DIAGNOSE),
  W7 (hardcoded demo fallbacks), W8 (verb-regex routing), W9 (loop-level
  retry), streaming, keep-alive/warm-up, mouse/alt-screen TUI, context
  compaction — see §8.

*Evaluator: GLM-5.3 (built-in to ZCode), edge session on this Mac, 2026-08-25.
All live probes ran against the real `.251` LAN server and Ollama Cloud.*
