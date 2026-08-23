# BUILD/12 — DOCS

**Phase:** 12
**Objective:** Complete user documentation: README, provider presets, role/model assignment guide, MOA usage guide, LAN guide, plugin reference.
**Gate:** README complete; provider presets cover all 75+ providers; docs link correctly.

---

## 1. README.md

Rewrite the fork's README with Anubis branding. Required sections:

```markdown
# Anubis

Mixture-of-Agents terminal coding agent. Fork of opencode (MIT).

## Install
curl -fsSL https://anubis.dev/install | bash

## Quick start
1. anubis
2. /connect  → add your providers
3. /models   → pick your models
4. /roles    → assign models to roles
5. /moa "your task"  → parallel MOA
6. /pipeline "your task"  → sequential pipeline

## What makes Anubis different
- Mixture of Agents: compose cloud + local + LAN models into one team
- No locked models: you choose which model fills each role
- Local-first cost: free local/LAN models handle cheap work
- 75+ providers: Anthropic, Google, OpenAI, Z.AI, Ollama, LM Studio, +70

## Roles
| Role | Function |
|---|---|
| anubis | orchestrator |
| planner | planning |
| coder | implementation |
| reviewer | diagnosis |
| critic | adversarial review |
| researcher | research |
| scribe | docs |
| swift | fast/cheap |

## Commands
/moa, /pipeline, /roles, /lan-scan, /cost, /models, /connect

## Plugins
caveman, ponytail, moa, pipeline, router, lan, cost-tracker,
vibeguard, dcp, notify, wakatime + 27 tier-2

## License
MIT (fork of opencode)
```

---

## 2. Provider presets

Create `docs/providers/` with one file per provider family. Each file is a copy-paste `opencode.json` snippet.

### 2.1 File list

| File | Providers |
|---|---|
| `anthropic.md` | Claude Sonnet/Opus/Haiku |
| `google.md` | Gemini 2.5 Pro/Flash, Vertex |
| `openai.md` | GPT-5.x, o3, Codex |
| `zai.md` | GLM-4.6, GLM-5 |
| `ollama.md` | local + cloud Ollama models |
| `lmstudio.md` | LM Studio local |
| `llamacpp.md` | llama.cpp local |
| `openrouter.md` | 300+ models via one key |
| `groq.md` | fast open models |
| `deepseek.md` | DeepSeek V4 |
| `local-lan.md` | ollama-lan, lmstudio-lan, llamacpp-lan |
| `subscription.md` | ChatGPT Plus, Copilot, Gemini, Antigravity (via tier-2 auth plugins) |
| `other.md` | the remaining 60+ providers (list + link to opencode docs) |

### 2.2 Preset format (example: `ollama.md`)

```markdown
# Ollama (local + cloud)

## Local models
```jsonc
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": {
        "gemma:latest": { "name": "Gemma (local)" },
        "qwen3-coder:30b": { "name": "Qwen3 Coder 30B (local)" }
      }
    }
  }
}
```

## Cloud models (Ollama Cloud)
Pull first: `ollama pull glm-5.2:cloud`
```jsonc
{
  "provider": {
    "ollama": {
      "models": {
        "glm-5.2:cloud": { "name": "GLM 5.2 (cloud)" },
        "minimax-m3:cloud": { "name": "MiniMax M3 (cloud)" }
      }
    }
  }
}
```

## Suggested roles
- reviewer: `ollama/gemma:latest` (free)
- swift: `ollama/minimax-m3:cloud`
- small_model: `ollama/gemma:latest`
```

### 2.3 Generate the "other" list

The full provider list lives in opencode docs. Generate `other.md` from:
```bash
# fetch the provider list
curl -fsSL https://opencode.ai/docs/providers | grep -oE 'href="/docs/providers/#[a-z0-9-]+"' | cut -d'"' -f2 | cut -d'#' -f2
```

---

## 3. Usage guides

### 3.1 `docs/roles.md` — role/model assignment

- Explain the three assignment mechanisms (config, picker, flag).
- Show `opencode.example.json` walkthrough.
- Cost strategy: local/LAN for cheap roles, cloud for heavy.

### 3.2 `docs/moa.md` — MOA usage

- `/moa` parallel mode.
- `/pipeline` sequential mode.
- Per-run role override.
- Aggregation behavior.

### 3.3 `docs/lan.md` — LAN setup

- Static config for known hosts.
- `/lan-scan` auto-discovery.
- Security notes.

### 3.4 `docs/plugins.md` — plugin reference

- Tier-1: what each does, config keys.
- Tier-2: source, purpose, install method.

### 3.5 `docs/cost.md` — cost optimization

- Local-first strategy.
- `small_model` to local.
- DCP + vibeguard + compaction.
- `/cost` reading.

---

## 4. Definition of Done (gate)

```bash
cd anubis
# verify docs render (if using a docs site) or are valid markdown
# verify all internal links resolve
grep -rn "BUILD/" docs/ README.md | head
```

**Gate PASSED** when:
- [ ] README complete with all required sections
- [ ] Provider presets cover all 75+ providers (or link to upstream list)
- [ ] All usage guides written
- [ ] Internal links resolve
- [ ] `opencode.example.json` referenced from README

**Gate FAILED** → fix docs; re-check.

---

## 5. Handoff

Gate passed → **project complete**. Run the full project-level Definition of Done from ANUBIS-SPEC.md §14.

Log in `BUILD/LOG.md`:
```
## Phase 12 — PASSED
- Date: <date>
- README: complete
- Presets: <n> files
- Guides: <n> files
```

---

## 6. Project completion checklist

Run this final checklist (from ANUBIS-SPEC.md §14):

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
