# RA — Repository Index

> Refreshed 2026-08-25 (Cycle 43 audit). Historical docs live in `docs/archive/`.

## What this is

RA (Relic Agent) — a terminal coding agent in the spirit of OpenCode, built as a
Mixture-of-Agents. Two packages, one app:

| Package | Role | Entry |
|---|---|---|
| `ra/` | Runtime: agent loop, tools, TUI, daemon, eval, IDE bridge | `ra/src/cli.ts` (bun) |
| `anubis/` | Engine: config, Ollama clients, router, cost, branding | consumed by `ra` via relative imports |

## Model topology (mac-weak profile)

- **small** — `qwen3.8:latest` @ `http://192.168.1.251:11434` (LAN box, 27B Q4_K_M)
- **BIG** — `glm-5.2` @ Ollama Cloud (`https://ollama.com/v1`, key in `anubis/.env`)
- **fallback** — `gemma:latest` @ `localhost:11434` (local ollama also proxies cloud models as `glm-5.2:cloud`)
- Policy: prefer small@251, escalate to cloud only when needed.

## Key paths

| Path | What |
|---|---|
| `ra/src/agent.ts` | Agent tool loop (`runTaskAgent`), TOOL_HINT grammar, orchestrator turn |
| `ra/src/tools/index.ts` | WRITE/EDIT/READ/BASH/GLOB/GREP/WEBFETCH/TODO tools (safePath, redact, checkpoints) |
| `ra/src/tui/app.ts` | Interactive TUI (readline + ANSI), palette, keybinds, cost sidebar |
| `ra/src/commands/index.ts` | Slash commands + custom commands from `~/.anubis/commands/*.md` |
| `ra/src/server/` | daemon (HTTP sessions), session JSON store, replay, remote client, checkpoints |
| `ra/src/eval.ts` | Eval harness: 22 tasks × every configured model, deterministic verify |
| `ra/src/mcp.ts` | MCP stdio + Streamable HTTP clients, OAuth PKCE |
| `anubis/src/ollama.ts` | Endpoint probing, model fallback chains, cloud/LAN clients |
| `anubis/src/runner.ts` | Full-dev pipeline (thoth → ptah → …) |
| `anubis/.anubis/agents/*.md` | Persona prompts + frontmatter (steps, temperature, permissions) |
| `anubis/.anubis/plugins/*.ts` | Built-in plugins (vibeguard, cost-tracker, moa, …) |
| `anubis/ra.json` | Active config (profile, providers, agents, permissions) |

## Daily commands

```bash
./install          # link binaries (ra, anubis)
./test.sh          # full gate: anubis + ra unit tests + live E2E (needs .251 + cloud key)
cd ra && bun test  # ra unit tests only
cd anubis && bun test  # anubis unit tests only

ra                 # interactive TUI
ra doctor          # environment + endpoint health
ra run "task" --quick --json   # headless pipeline run
ra eval            # model eval harness
ra daemon          # session server (:8080); TUI attaches via --remote URL
```

## Docs map

- `README.md` — front door, install
- `PLAN.md` — **RA 2.0 master plan** (phases 0–4 from the 2026-08-25 competitive audit)
- `STATUS.md` — per-cycle log + smoke results (source of truth for state)
- `ROADMAP.md` — legacy P0–P3 backlog (superseded by PLAN.md)
- `CHANGELOG.md` — feature log
- `DECISIONS.md` — ADRs D-001…D-030
- `ANUBIS-SPEC.md`, `BUILD/` — original build spec (historical)
- `EVALUATION.md` — 2026-08-25 system audit + improvement roadmap
- `docs/archive/` — superseded docs (2026-08-15 era)
