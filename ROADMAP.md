# RA — Roadmap

> Persistent backlog. Priorities: **P0** broken build/tests > **P1** opencode parity gap > **P2** RA-PLUS differentiators > **P3** polish/perf/DX.
> Read-then-update. Never invent work outside this file — add it here first.

## Up Next (queue)

1. **[P1] Client/server split** — background daemon owns sessions/state/FS; TUI is a thin client. (ARCHITECTURE CORE)
2. **[P1] Multi-session** — parallel sessions on same project, list/switch/kill.
3. **[P1] Sessions persist across terminal disconnects** — `ra` reattaches cleanly (partial: disk persistence exists, no daemon).

---

## P0 — Broken build/tests

- [x] Build green (`bun test` 143 pass in anubis, 12 pass in ra runtime)
- [x] Full gate green (`./test.sh` passes end-to-end, cloud + local)

## P1 — OpenCode Parity Backlog

### Architecture Core
- [ ] Client/server split: background daemon owns sessions, state, FS ops; TUI is a thin client
- [ ] Sessions persist across terminal disconnects; `ra` reattaches cleanly (partial: `session.ts` persists to disk, no daemon)
- [ ] Multi-session: parallel sessions on same project, list/switch/kill
- [x] Headless/non-interactive mode: `ra run "task"` for CI/scripting (added `ra run` with `--quick/--verify/--json/--cwd`, no TUI splash)
- [x] JSON config file (`ra.json`) + env var overrides + sane defaults (`ra.json` loads; added `RA_MODEL`/`RA_SMALL_MODEL`/`ANUBIS_MODEL`/`ANUBIS_SMALL_MODEL` env overrides)

### Model Layer
- [x] Provider abstraction (partial: `ollama.ts` has cloud/local/LAN clients, not a full pluggable interface)
- [ ] 75+ provider compatibility via OpenAI-compatible endpoints + models.dev catalog ingestion (partial: docs claim 75+, code only wires Ollama cloud/local/LAN)
- [x] Local models: Ollama + LM Studio auto-discovery (partial: Ollama yes, LM Studio not verified)
- [x] Per-agent model assignment in config (`agent.<role>.model` in `anubis.json`)
- [ ] Model router: automatic fallback chain cloud→local on failure/rate-limit, with per-request cost + latency logging (partial: `pickOllamaEndpoint` picks one endpoint, no chain)

### Agent System
- [x] Primary agents: Build (ptah, full tools) and Plan (thoth, read-only)
- [ ] Subagents: General, Explore, Scout — spawnable, visible in TUI with subagent tree
- [ ] Custom agents as Markdown files with frontmatter (partial: `.anubis/agents/*.md` exist, frontmatter parsing minimal)
- [x] Tool set: read/write/edit (diff-based), bash, grep, glob, ls (partial: no webfetch, no task/subagent spawn, no todo tracking)
- [ ] Permission engine: per-tool allow/ask/deny rules, per-session approvals (partial: `permission.skill` only)

### Code Intelligence
- [ ] LSP integration: auto-detect language, spawn server, feed diagnostics after every edit
- [ ] Tree-sitter or equivalent for symbol outline + navigation
- [ ] AGENTS.md / RA.md project memory auto-loaded into system context

### MCP + Extensibility
- [ ] MCP client: stdio, SSE/HTTP, OAuth; per-agent server config
- [ ] MCP Tool Search: lazy-load tool definitions
- [x] Plugin system + hooks (partial: 9 tier-1 plugins, hook surface limited)
- [ ] Custom slash commands (Markdown-defined), keybinds, themes (partial: hardcoded slash commands)

### TUI Experience
- [x] Multi-pane TUI (partial: single-pane chat + command palette, no live token/cost sidebar, no diff viewer, no @-mention)
- [ ] Session share/export (sanitized transcript)
- [ ] Undo/checkpoint: snapshot before each agent edit batch

### Integrations
- [ ] GitHub Action: `/ra` comment on PRs triggers agent (partial: `.github/workflows/test.yml` is CI only)
- [ ] IDE extension host protocol (VS Code JSON-RPC bridge)

## P2 — RA-PLUS (Beyond Parity)

- [ ] EVAL HARNESS: 20+ real coding tasks against every configured model; results table in STATUS.md
- [ ] SWARM MODE: N parallel agents on git worktrees + merge/conflict resolution
- [ ] Semantic code search: local embeddings + vector index, incremental re-index
- [ ] Cost dashboard: per-session/per-model token + USD analytics in TUI
- [ ] Air-gapped mode: single flag → 100% local, zero telemetry
- [ ] Session replay + time-travel debugging
- [ ] Web dashboard reading from daemon API
- [ ] Self-healing loops: on test failure, auto-diagnose + retry (max 3), log to BUGS.md

## P3 — Polish / Perf / DX

- [ ] `ra run` alias for headless mode (cleaner than `ra --task`)
- [ ] Live token/cost sidebar in TUI
- [ ] Diff viewer in TUI
- [ ] @-mention file picker
- [ ] LM Studio auto-discovery verification
- [ ] webfetch tool
- [ ] todo tracking tool
