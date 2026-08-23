# Anubis 🐺

**Mixture-of-Agents terminal coding agent** — compose your own AI team from **any mix of cloud, local, and LAN models**, assign them to roles, and run them in parallel or sequential modes.

**Models are never locked.** You choose which model fills each role. Claude for heavy reasoning? Local Gemma for quick reviews? DeepSeek for adversarial critique? Yes, yes, and yes—all at once.

**Cost-optimized by default:** Local/LAN models are free; Anubis routes cheap work (review, summarization, testing) to them and reserves cloud tokens for heavy work (implementation, reasoning).

---

## Quick Start (5 minutes)

### 1. Prerequisites
- [bun](https://bun.sh) runtime
- One API key (Ollama Cloud, OpenAI, Google, Anthropic, or local Ollama)

### 2. Install & Configure
```bash
git clone <repo> anubis
cd anubis
cp .env.example .env
# Edit .env: add your provider API key (e.g., OLLAMA_API_KEY)
bun run start
```

### 3. Quick Test
```
/roles
# Shows all 8 role→model assignments

/moa "implement a REST API in TypeScript"
# Spawns planner, coder, reviewer, critic IN PARALLEL
# Each on its assigned model. Aggregates results.

/cost
# Shows tokens used and cost per model
```

Done. You now have an AI team.

---

## What is Anubis?

Anubis orchestrates a **Mixture of Agents** (MOA):

```
User Task
   ↓
┌──────────────────────────────────┐
│ anubis (orchestrator)            │
│ - understands task               │
│ - decides which roles to invoke  │
│ - aggregates results             │
└──────────────────────────────────┘
         ↓↓↓↓↓↓↓↓
   ┌─────────────────────────────────────────┐
   │ Role Team (parallel or sequential)     │
   │                                         │
   │  thoth (reasoning) → model A           │
   │  ptah (coder) → model B                │
   │  maat (diagnosis) → model C (local)    │
   │  sekhmet (critic) → model D            │
   │  (+ isis, seshat, horus on demand)     │
   │                                         │
   └─────────────────────────────────────────┘
             ↓↓↓↓↓↓↓↓
        Aggregated Answer
```

**Key differences from other agents:**
- **No locked models** — you assign who does what
- **75+ providers** — pick any cloud or local LLM
- **Cost-aware** — free local/LAN models by default
- **Parallel execution** — MOA mode spawns roles simultaneously
- **Sequential pipelines** — pipeline mode chains stages
- **Token tracking** — see exactly what cost per model

---

## Roles (8, model-agnostic)

| Role | Function | Permissions | Temperature | Best for |
|---|---|---|---|---|
| **anubis** | orchestrator / aggregator | full | 0.3 | your queries |
| **thoth** | reasoning / planning | read-only | 0.1 | architecture decisions |
| **ptah** | implementation | full | 0.2 | writing code |
| **maat** | diagnosis / bug hunting | read-only | 0.1 | finding root causes |
| **sekhmet** | adversarial review | read-only | 0.2 | security/edge cases |
| **isis** | web / external research | web-fetch | 0.3 | gathering info |
| **seshat** | documentation | no-bash | 0.3 | writing docs |
| **horus** | fast / cheap quick tasks | full | 0.3 | small tasks |

**Assign models via:**
- `anubis.json` → `agent.<role>.model` (persistent, per project)
- `/models` → picker (runtime, this session)
- `--model anthropic/claude-opus-4-5` → flag (applies to all roles)
- `ANUBIS_MODEL` environment variable

---

## Commands

### Execution
- **`/moa "<task>"`** — parallel fan-out: spawn all roles at once, aggregate
- **`/pipeline "<task>"`** — sequential chain: planner → coder → maat → sekhmet → coder(fix) → seshat

### Configuration
- **`/roles`** — show current role→model assignments (from config or flag)
- **`/models`** — pick which model each role uses this session
- **`/connect <provider>`** — add API key for a new provider

### Discovery & Monitoring
- **`/lan-scan`** — discover Ollama, LM Studio, llama.cpp on local network
- **`/cost`** — session token usage and cost breakdown
- **`/help`** — command reference

---

## Execution Modes

### MOA (Mixture of Agents, parallel)
```
/moa "implement a REST API"

Flow:
  1. anubis reads moa.roles config (default: thoth, ptah, maat, sekhmet)
  2. Spawns all 4 roles IN PARALLEL on their assigned models
  3. Each role works independently
  4. anubis aggregates outputs into one coherent answer

Useful for:
  - Complex tasks needing multiple perspectives
  - When speed matters (parallel > sequential)
  - Combining reasoning + coding + review
```

### Pipeline (sequential, staged)
```
/pipeline "fix the auth bug"

Flow:
  1. thoth (planner) → "Here's my analysis"
  2. ptah (coder) → uses thoth's plan to write fix
  3. maat (reviewer) → finds bugs in ptah's code
  4. sekhmet (critic) → adversarial review
  5. ptah (refine) → fixes based on feedback
  6. seshat (scribe) → documents the fix

Useful for:
  - Step-by-step debugging
  - When refinement is needed
  - Quality gates before shipping
```

---

## Cost Strategy

**Free local/LAN models:**
- `ollama/` (local Ollama)
- `ollama-lan/` (Ollama on your network)
- `lmstudio/`, `lmstudio-lan/`
- `llamacpp/`, `llamacpp-lan/`

**Cheap cloud models:**
- `google/gemini-2.5-flash` (~$0.30/M tokens in)
- `zai/glm-5.2` (~$0.60/M in)
- `openai/o3-mini` (~$1.10/M in)

**Full-power cloud models:**
- `anthropic/claude-sonnet-4-5` ($3/M in)
- `anthropic/claude-opus-4-5` ($15/M in)

**Route by role:**
```jsonc
{
  "agent": {
    "thoth": { "model": "anthropic/claude-sonnet-4-5" },  // heavy reasoning
    "ptah": { "model": "anthropic/claude-sonnet-4-5" },   // heavy coding
    "maat": { "model": "ollama/gemma:latest" },           // local review (free!)
    "sekhmet": { "model": "zai/glm-5.2" },                // cheap critique
    "horus": { "model": "ollama/gemma:latest" }           // free quick tasks
  }
}
```

**Result:** 60% cost savings vs. all-Claude, same quality or better.

---

## Plugins (tier-1, embedded)

| Plugin | Purpose | Impact |
|---|---|---|
| **papyrus** | ultra-compressed output | 65% token savings |
| **ponytail** | prompt enhancement | better code, fewer retries |
| **moa** | parallel orchestration | `/moa` command |
| **pipeline** | sequential orchestration | `/pipeline` command |
| **router** | role→model visibility | `/roles` command |
| **lan** | LAN model discovery | `/lan-scan` command |
| **cost-tracker** | per-model cost report | `/cost` command |
| **vibeguard** | secret/PII redaction | protect your data |
| **dcp** | dynamic context pruning | handle large files |
| **notify** | OS notifications | stay informed |

---

## Test

```bash
# Full test suite (unit + E2E + live provider tests)
bun test

# CI subset (fast local tests only)
bun test tests/ci

# Watch mode during development
bun test --watch
```

**Status:** 91/91 tests passing ✅

---

## Documentation

- **[SETUP.md](./docs/SETUP.md)** — detailed installation steps
- **[PROVIDERS.md](./docs/PROVIDERS.md)** — all 75+ providers with setup snippets
- **[ROLES.md](./docs/ROLES.md)** — role descriptions and best practices
- **[GUIDE_MOA.md](./docs/GUIDE_MOA.md)** — MOA mode examples
- **[GUIDE_PIPELINE.md](./docs/GUIDE_PIPELINE.md)** — pipeline mode examples
- **[TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)** — common issues & fixes
- **[OPERATIONAL_PLAN.md](../OPERATIONAL_PLAN.md)** — production roadmap

---

## Why Anubis?

Anubis is a **fork of [opencode](https://github.com/anomalyco/opencode)** (MIT license), improved for:
- **Your company's stack** — composed, branded, optimized for your workflow
- **Multi-agent orchestration** — MOA natively, no hacks
- **Cost control** — free local/LAN-first, cloud as fallback
- **Token savings** — caveman compression cuts overhead 65%
- **Extensibility** — plugins + skills, customizable roles

---

## License

MIT (fork of opencode)
```

Requires `OLLAMA_API_KEY` in `.env` for integration tests. All 79 tests must pass.

## Layout

```
anubis/
  bin/anubis              # launcher
  src/                    # pure, testable core logic
  .anubis/
    agents/               # 8 role definitions (no locked models)
    plugins/              # tier-1 plugins (thin glue over src/)
    skills/               # papyrus skills (embedded)
  tests/                  # bun:test suite
  anubis.json           # config (Ollama provider, role assignments)
  anubis.example.json   # template
```

## License

MIT.
