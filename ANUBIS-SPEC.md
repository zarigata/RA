# ANUBIS — Master Specification

**Mixture-of-Agents terminal coding agent. Fork of opencode.**
**Version:** 1.0.0
**Status:** BUILD READY
**Date:** 2026-08-12

---

## 1. Vision

Anubis is a terminal AI coding agent built as a fork of [opencode](https://github.com/anomalyco/opencode) (MIT license). It gives the user a **Mixture of Agents (MOA)** harness: the user composes their own team of AI models from **any mix of cloud, local, and LAN endpoints**, assigns them to **roles**, and runs them in **parallel fan-out** or **sequential pipeline** modes.

**Core principle: models are never locked.** Roles are defined by function (prompt, permissions, temperature). The user decides which model fills each role — 2 cloud + 2 local + 2 LAN, or all cloud, or all local. Anubis orchestrates whatever team the user builds.

**Cost principle:** local and LAN models are free. Anubis routes cheap work (diagnosis, review, summarization, meta tasks) to local/LAN by default and reserves cloud tokens for heavy work (implementation, deep reasoning). The user stays in control via per-role assignment.

---

## 2. Why opencode as the base

| Requirement | opencode | aider | goose |
|---|---|---|---|
| License | MIT | Apache-2.0 | Apache-2.0 |
| Per-agent model routing | **Native** (`agent.model`) | No | No |
| Plugin system (hooks + custom tools) | **Native** | No | Partial (MCP) |
| Providers | **75+** | ~15 | 15+ |
| Parallel subagent execution | **Native** (`task` tool) | No | No |
| Single-binary install | **Yes** | pip | Rust build |
| Already in use by this project | **Yes** | No | No |

Only opencode satisfies the MOA + plugin + multi-provider + parallel-execution requirements natively. **Decision: fork opencode.**

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        ANUBIS TUI                            │
│  /moa "task"        /pipeline "task"      /lan-scan          │
│  /models            /roles               /cost               │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                    ORCHESTRATOR (anubis)                     │
│  role→model assignment (user-configured, never locked)      │
│  parallel fan-out  OR  sequential pipeline                    │
└──────┬──────────────┬──────────────┬──────────────┬──────────┘
       │              │              │              │
┌──────▼─────┐ ┌──────▼─────┐ ┌──────▼─────┐ ┌──────▼─────┐
│  planner   │ │   coder    │ │  reviewer  │ │  critic    │
│  (model A) │ │  (model B) │ │  (model C) │ │  (model D) │
└────────────┘ └────────────┘ └────────────┘ └────────────┘
       │              │              │              │
┌──────▼─────┐ ┌──────▼─────┐ ┌──────▼─────┐ ┌──────▼─────┐
│ researcher │ │  scribe    │ │   swift    │ │  (LAN)     │
│  (model E) │ │  (model F) │ │  (model G) │ │  (model H) │
└────────────┘ └────────────┘ └────────────┘ └────────────┘

PROVIDER LAYER (75+): anthropic, google, openai, z.ai, ollama,
  ollama-lan, lmstudio, lmstudio-lan, llamacpp, llamacpp-lan,
  openrouter, groq, deepseek, + 65 more
```

### 3.1 Component map

| Component | Type | Location | Spec |
|---|---|---|---|
| `anubis` | primary agent | `.opencode/agents/anubis.md` | BUILD/02-ROLES.md |
| `planner` | subagent | `.opencode/agents/planner.md` | BUILD/02-ROLES.md |
| `coder` | subagent | `.opencode/agents/coder.md` | BUILD/02-ROLES.md |
| `reviewer` | subagent | `.opencode/agents/reviewer.md` | BUILD/02-ROLES.md |
| `critic` | subagent | `.opencode/agents/critic.md` | BUILD/02-ROLES.md |
| `researcher` | subagent | `.opencode/agents/researcher.md` | BUILD/02-ROLES.md |
| `scribe` | subagent | `.opencode/agents/scribe.md` | BUILD/02-ROLES.md |
| `swift` | subagent | `.opencode/agents/swift.md` | BUILD/02-ROLES.md |
| caveman skills | skills | `.opencode/skills/caveman*/` | BUILD/03-CAVEMAN.md |
| ponytail | plugin | `.opencode/plugins/ponytail.ts` | BUILD/04-PONYTAIL.md |
| moa | plugin | `.opencode/plugins/moa.ts` | BUILD/05-MOA.md |
| router | plugin | `.opencode/plugins/router.ts` | BUILD/06-ROUTER.md |
| lan | plugin | `.opencode/plugins/lan.ts` | BUILD/07-LAN.md |
| cost-tracker | plugin | `.opencode/plugins/cost-tracker.ts` | BUILD/08-PLUGINS.md |
| vibeguard | plugin | `.opencode/plugins/vibeguard.ts` | BUILD/08-PLUGINS.md |
| dcp | plugin | `.opencode/plugins/dcp.ts` | BUILD/08-PLUGINS.md |
| notify | plugin | `.opencode/plugins/notify.ts` | BUILD/08-PLUGINS.md |
| wakatime | plugin | `.opencode/plugins/wakatime.ts` | BUILD/08-PLUGINS.md |
| tier-2 bundle | plugins | `.opencode/plugins/` + npm | BUILD/08-PLUGINS.md |
| installer | script | `install` (repo root) | BUILD/09-INSTALLER.md |
| tests | suite | `tests/` | BUILD/10-TESTS.md |
| docs | docs | `README.md`, `docs/` | BUILD/12-DOCS.md |

---

## 4. Role roster (model-agnostic)

| Role | Function | Permissions | Temperature | Steps |
|---|---|---|---|---|
| `anubis` | orchestrator, aggregator, main chat | full | 0.3 | unlimited |
| `planner` | reasoning, planning, architecture | read-only | 0.1 | 10 |
| `coder` | implementation | full | 0.2 | unlimited |
| `reviewer` | diagnosis, bug hunting | read-only | 0.1 | 8 |
| `critic` | adversarial deep review | read-only | 0.2 | 8 |
| `researcher` | web/external research | MCP + webfetch | 0.3 | 6 |
| `scribe` | documentation | write, no bash | 0.3 | 6 |
| `swift` | fast/cheap quick tasks | full | 0.3 | 4 |

**No role carries a `model` field.** Model assignment happens in three places, in priority order:

1. `--model` CLI flag (session-wide)
2. `agent.<role>.model` in `opencode.json` (per-role)
3. `/models` picker (runtime, per-session)

See BUILD/06-ROUTER.md for the assignment UX.

---

## 5. MOA execution modes

### 5.1 `/moa "task"` — parallel fan-out

1. User runs `/moa "implement X"`.
2. `moa` plugin reads `moa.roles` config (which roles participate, which models).
3. `anubis` spawns each participating role as a **parallel subagent** via the `task` tool.
4. Each role works independently on its assigned model.
5. `anubis` aggregates all outputs into a final synthesized answer.

### 5.2 `/pipeline "task"` — sequential chain

1. User runs `/pipeline "fix bug Y"`.
2. `pipeline` plugin reads `pipeline.stages` config (ordered role list).
3. Stages run one at a time: `planner` → `coder` → `reviewer` → `critic` → `coder` (fix) → `scribe`.
4. Each stage's output feeds the next stage's input.
5. Final stage produces the deliverable.

### 5.3 Hybrid

Both modes accept a role list override: `/moa "task" @planner @coder @reviewer`. The orchestrator uses the listed roles regardless of config.

---

## 6. LAN agents (multi-machine)

Anubis treats LAN model servers as first-class providers:

| Provider ID | Default port | Server |
|---|---|---|
| `ollama-lan` | 11434 | Ollama on another machine |
| `lmstudio-lan` | 1234 | LM Studio on another machine |
| `llamacpp-lan` | 8080 | llama.cpp server on another machine |

- `/lan-scan` plugin scans the local subnet for open model ports, verifies `/v1/models`, and registers working endpoints as custom providers.
- LAN models appear in `/models` picker exactly like cloud/local models.
- LAN roles are free — ideal for `reviewer`, `swift`, `scribe`, `title`, `summary`.

See BUILD/07-LAN.md.

---

## 7. Plugin bundle

### 7.1 Tier-1 (embedded, always on)

| Plugin | Purpose | Spec |
|---|---|---|
| caveman | token compression skills | BUILD/03 |
| ponytail | prompt enhancement | BUILD/04 |
| moa | parallel orchestration | BUILD/05 |
| pipeline | sequential orchestration | BUILD/05 |
| router | role→model assignment | BUILD/06 |
| lan | LAN discovery | BUILD/07 |
| cost-tracker | per-role token/cost | BUILD/08 |
| vibeguard | secret/PII redaction | BUILD/08 |
| dcp | dynamic context pruning | BUILD/08 |
| notify | OS notifications | BUILD/08 |
| wakatime | usage tracking | BUILD/08 |

### 7.2 Tier-2 (bundled, installable)

background-agents, pty, worktree, websearch-cited, supermemory, conductor, subtask2, morph-fast-apply, firecrawl, tavily, scheduler, helicone-session, sentry-monitor, type-inject, md-table-formatter, shell-strategy, goal-plugin, daytona, devcontainers, gemini-auth, codex-auth, antigravity-auth, oh-my-opencode, opencode-agents, Agentic, workspace, ocx.

See BUILD/08-PLUGINS.md for the full matrix with source URLs and integration notes.

---

## 8. Cost optimization strategy

| Lever | Mechanism | Effect |
|---|---|---|
| Local/LAN roles | `reviewer`, `swift`, `scribe` default to free models | Cloud tokens saved |
| `small_model` | title/summary/compaction → local model | Meta tokens near-zero |
| DCP | prune obsolete tool outputs | Context bloat reduced |
| vibeguard | redact secrets before LLM calls | No leak, no retry cost |
| compaction hooks | inject state into continuation prompt | Fewer full-context calls |
| cost-tracker | per-role token/cost visibility | User sees where spend goes |
| router | user-controlled assignment | User decides cost/quality tradeoff |

---

## 9. Build phases and gates

| Phase | File | Gate (Definition of Done) |
|---|---|---|
| 00 | BUILD/00-TERRAFORM.md | `bun install` clean; `anubis --version` boots; dev env works |
| 01 | BUILD/01-BRAND.md | TUI splash shows "Anubis"; package renamed |
| 02 | BUILD/02-ROLES.md | 8 roles respond; no role has a pinned model |
| 03 | BUILD/03-CAVEMAN.md | caveman skills load; `/caveman` works |
| 04 | BUILD/04-PONYTAIL.md | ponytail loads; prompt enhancement fires |
| 05 | BUILD/05-MOA.md | `/moa` parallel + `/pipeline` sequential pass |
| 06 | BUILD/06-ROUTER.md | role→model assignment via config/picker/flag |
| 07 | BUILD/07-LAN.md | `/lan-scan` finds LAN hosts; LAN models usable |
| 08 | BUILD/08-PLUGINS.md | all tier-1 + tier-2 load without conflicts |
| 09 | BUILD/09-INSTALLER.md | fresh-VM curl install passes on 3 OS |
| 10 | BUILD/10-TESTS.md | all test suites green |
| 11 | BUILD/11-BUGFIX.md | triaged issues resolved; regression green |
| 12 | BUILD/12-DOCS.md | README + provider presets complete |

**Execution rule:** phases run in order. A phase is complete only when its gate passes. If a gate fails, fix within the phase (see BUILD/11-BUGFIX.md) before advancing.

---

## 10. Repository layout (target)

```
anubis/                        # fork of anomalyco/opencode
├── install                    # one-liner installer (BUILD/09)
├── package.json               # renamed, "anubis"
├── .opencode/
│   ├── agents/                # 8 role agents (BUILD/02)
│   ├── skills/                # caveman skills (BUILD/03)
│   ├── plugins/               # tier-1 + tier-2 (BUILD/04-08)
│   └── package.json           # plugin deps
├── tests/                     # test suites (BUILD/10)
├── docs/                      # user docs (BUILD/12)
└── README.md
```

---

## 11. How to execute this plan with opencode

This spec is designed to be executed entirely by opencode. Recommended workflow:

1. **Phase 00** — run opencode in the `anubis/` fork directory. Ask it to follow `BUILD/00-TERRAFORM.md`.
2. **Each phase** — open the phase file, follow it top to bottom. Each file is self-contained: objective, exact files, exact commands, copy-paste config, definition of done, failure modes.
3. **Gate check** — after each phase, run the gate command(s) listed in the phase. Do not advance until green.
4. **Bugfix** — if a gate fails, consult `BUILD/11-BUGFIX.md` for the triage playbook, then fix.
5. **Tests** — run `BUILD/10-TESTS.md` suites after phases 05, 07, 08, and at the end.

### 11.1 Suggested opencode invocation per phase

```
# Phase 00 (in a fresh terminal, from the parent of the fork target)
opencode --model <your-model>   # then: "Read BUILD/00-TERRAFORM.md and execute it exactly."

# Phases 01-12 (from inside anubis/)
opencode   # then: "Read BUILD/0X-*.md and execute it exactly. Run the gate. Report."
```

### 11.2 Cross-file dependencies

| File | Depends on |
|---|---|
| 00-TERRAFORM | nothing |
| 01-BRAND | 00 |
| 02-ROLES | 00, 01 |
| 03-CAVEMAN | 00, 01 |
| 04-PONYTAIL | 00, 01, 03 |
| 05-MOA | 00, 01, 02 |
| 06-ROUTER | 00, 01, 02 |
| 07-LAN | 00, 01 |
| 08-PLUGINS | 00, 01, 03, 04, 05, 06, 07 |
| 09-INSTALLER | 00, 01 |
| 10-TESTS | 05, 07, 08 |
| 11-BUGFIX | all |
| 12-DOCS | all |

---

## 12. Non-goals (explicit)

- **No model locking.** Anubis never hardcodes a model into a role.
- **No proprietary code.** Fork stays MIT. Claude Code is closed-source and is NOT a base.
- **No cloud-only dependency.** Anubis works fully offline with local/LAN models.
- **No GPU hogging.** Local models run in Ollama/LM Studio/llama.cpp (user-managed); Anubis itself is a lightweight TUI.
- **No telemetry by default.** All tracking is opt-in (wakatime, helicone, sentry).

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Fork drift from upstream | Track upstream; rebase periodically; keep fork changes in `.opencode/` + branding only |
| Plugin conflicts | BUILD/08 defines load-order and conflict matrix; tests cover |
| LAN discovery false positives | `/lan-scan` verifies `/v1/models` before registering |
| MOA output quality variance | Aggregator prompt in BUILD/05; critic role catches errors |
| Cost surprises | cost-tracker + router give visibility and control |
| Local model tool-calling weakness | BUILD/02 documents which roles need strong tool-calling; user picks models accordingly |

---

## 14. Definition of Done (project-level)

- [ ] Fork builds and boots as `anubis`
- [ ] 8 roles functional, zero pinned models
- [ ] caveman + ponytail embedded and working
- [ ] `/moa` and `/pipeline` pass end-to-end tests
- [ ] Router assignment works via config, picker, and flag
- [ ] `/lan-scan` discovers and registers LAN models
- [ ] All tier-1 + tier-2 plugins load without conflict
- [ ] One-liner installer passes on macOS, Linux, Windows
- [ ] Full test suite green
- [ ] README + provider presets complete
