# RA — Roadmap

> Persistent backlog. Priorities: **P0** broken build/tests > **P1** opencode parity gap > **P2** RA-PLUS differentiators > **P3** polish/perf/DX.
> Read-then-update. Never invent work outside this file — add it here first.

## Up Next (queue)

1. **[P1] IDE extension host protocol** — VS Code JSON-RPC bridge.
2. **[P2] EVAL HARNESS** — 20+ real coding tasks against every configured model.
3. **[P2] Semantic code search** — local embeddings + vector index.

---

## P0 — Broken build/tests

- [x] Build green (`bun test` 143 pass in anubis, 12 pass in ra runtime)
- [x] Full gate green (`./test.sh` passes end-to-end, cloud + local)

## P1 — OpenCode Parity Backlog

### Architecture Core
- [x] Client/server split: background daemon owns sessions, state, FS ops; TUI is a thin client (partial: `ra daemon` HTTP server owns session state; TUI still runs in-process, not yet a remote client)
- [x] Sessions persist across terminal disconnects; `ra` reattaches cleanly (partial: `session.ts` persists to disk + TUI shows a reattach summary; no daemon)
- [x] Multi-session: parallel sessions on same project, list/switch/kill (partial: list + kill via `ra sessions`/`/sessions`; switch not yet wired)
- [x] Headless/non-interactive mode: `ra run "task"` for CI/scripting (added `ra run` with `--quick/--verify/--json/--cwd`, no TUI splash)
- [x] JSON config file (`ra.json`) + env var overrides + sane defaults (`ra.json` loads; added `RA_MODEL`/`RA_SMALL_MODEL`/`ANUBIS_MODEL`/`ANUBIS_SMALL_MODEL` env overrides)

### Model Layer
- [x] Provider abstraction (partial: `resolveProviderClient` resolves custom `provider/*` config to OpenAI-compatible clients with `{env:VAR}` templating; built-in Ollama path preserved)
- [x] 75+ provider compatibility via OpenAI-compatible endpoints + models.dev catalog ingestion (added `catalog.ts` + `ra catalog`; 193 providers, 167 OpenAI-compatible, converted to `provider` config)
- [x] Local models: Ollama + LM Studio auto-discovery (added `discoverLocalOpenAI` for LM Studio/llama.cpp OpenAI-compatible servers + `fromOpenAI` client)
- [x] Per-agent model assignment in config (`agent.<role>.model` in `anubis.json`)
- [x] Model router: automatic fallback chain cloud→local on failure/rate-limit, with per-request cost + latency logging (added `fallbackChain` + `runWithFallback` with per-attempt host/latency logging; `runner.ts` refactored to use it)

### Agent System
- [x] Primary agents: Build (ptah, full tools) and Plan (thoth, read-only)
- [x] Subagents: General, Explore, Scout — spawnable, visible in TUI with subagent tree (partial: `general`/`explore`/`scout` agent defs + `TASK` spawn tool; TUI subagent tree not yet)
- [x] Custom agents as Markdown files with frontmatter (partial: `permission`/`steps`/`temperature` frontmatter now honored; `model`/`tools` frontmatter not yet)
- [x] Tool set: read/write/edit (diff-based), multi-edit, bash, grep, glob, ls, webfetch, todo tracking, task (subagent spawn)
- [x] Permission engine: per-tool allow/ask/deny rules, per-session approvals (partial: `permission.tool` + agent frontmatter `permission` enforced in agent loop; `ask`/interactive approval not yet wired)

### Code Intelligence
- [x] LSP integration: auto-detect language, spawn server, feed diagnostics after every edit (partial: `diagnostics.ts` runs the language compiler/linter + `DIAGNOSE` tool; no full LSP server protocol)
- [x] Tree-sitter or equivalent for symbol outline + navigation (added regex-based `symbols.ts` outline + `OUTLINE` tool; no native tree-sitter dep)
- [x] AGENTS.md / RA.md project memory auto-loaded into system context (added `loadProjectMemory`, injected into agent + orchestrator system prompts)

### MCP + Extensibility
- [x] MCP client: stdio, SSE/HTTP, OAuth; per-agent server config (partial: stdio client + `mcp` config block + `loadMcpTools`; SSE/HTTP + OAuth not yet)
- [x] MCP Tool Search: lazy-load tool definitions (added `searchMcpTools` — connects on demand and filters by name/description)
- [x] Plugin system + hooks (partial: 9 tier-1 plugins, hook surface limited)
- [x] Custom slash commands (Markdown-defined), keybinds, themes (partial: Markdown-defined commands in `.anubis/commands/*.md`; keybinds/themes not yet)

### TUI Experience
- [x] Multi-pane TUI (partial: single-pane chat + command palette + @-mention file picker; no live token/cost sidebar, no diff viewer)
- [x] Session share/export (sanitized transcript) — `ra export` writes a vibeguard-redacted Markdown transcript
- [x] Undo/checkpoint: snapshot before each agent edit batch (added `checkpoint.ts` + `ra undo`/`ra checkpoints`; `toolWrite`/`toolEdit` snapshot before modifying)

### Integrations
- [x] GitHub Action: `/ra` comment on PRs triggers agent (added `.github/workflows/ra-agent.yml` — `/ra` comment runs `ra run` headless and posts the result)
- [ ] IDE extension host protocol (VS Code JSON-RPC bridge)

## P2 — RA-PLUS (Beyond Parity)

- [ ] EVAL HARNESS: 20+ real coding tasks against every configured model; results table in STATUS.md
- [ ] SWARM MODE: N parallel agents on git worktrees + merge/conflict resolution
- [ ] Semantic code search: local embeddings + vector index, incremental re-index
- [x] Cost dashboard: per-session/per-model token + USD analytics in TUI (added per-session usage store + `ra cost --session`; TUI sidebar still pending)
- [x] Air-gapped mode: single flag → 100% local, zero telemetry (added `airgap` config + `RA_AIRGAP` env; localizes cloud models and blocks non-local webfetch)
- [ ] Session replay + time-travel debugging
- [x] Web dashboard reading from daemon API (added `GET /` HTML dashboard to the daemon)
- [x] Self-healing loops: on test failure, auto-diagnose + retry (max 3), log to BUGS.md (added `selfheal.ts`)

## P3 — Polish / Perf / DX

- [x] `ra run` alias for headless mode (added in Cycle 2)
- [ ] Live token/cost sidebar in TUI
- [ ] Diff viewer in TUI
- [x] @-mention file picker (added in Cycle 19)
- [x] LM Studio auto-discovery (added in Cycle 20)

