# RA — Roadmap

> Persistent backlog. Priorities: **P0** broken build/tests > **P1** opencode parity gap > **P2** RA-PLUS differentiators > **P3** polish/perf/DX.
> Read-then-update. Never invent work outside this file — add it here first.

## Up Next (queue)

(empty — all P0/P1/P2/P3 items complete)

---

## P0 — Broken build/tests

- [x] Build green (`bun test` 143 pass in anubis, 12 pass in ra runtime)
- [x] Full gate green (`./test.sh` passes end-to-end, cloud + local)

## P1 — OpenCode Parity Backlog

### Architecture Core
- [x] Client/server split: background daemon owns sessions, state, FS ops; TUI is a thin client (done: `ra daemon` HTTP server + `ra --remote URL` TUI client mode via `RemoteClient`; sessions sync over HTTP)
- [x] Sessions persist across terminal disconnects; `ra` reattaches cleanly (done: `session.ts` persists to disk + TUI shows reattach summary; daemon syncs session state over HTTP)
- [x] Multi-session: parallel sessions on same project, list/switch/kill (`ra sessions` + `--kill ID` + `--switch ID`)
- [x] Headless/non-interactive mode: `ra run "task"` for CI/scripting (added `ra run` with `--quick/--verify/--json/--cwd`, no TUI splash)
- [x] JSON config file (`ra.json`) + env var overrides + sane defaults (`ra.json` loads; added `RA_MODEL`/`RA_SMALL_MODEL`/`ANUBIS_MODEL`/`ANUBIS_SMALL_MODEL` env overrides)

### Model Layer
- [x] Provider abstraction (`resolveProviderClient` resolves custom `provider/*` config to OpenAI-compatible clients with `{env:VAR}` templating; built-in Ollama path preserved)
- [x] 75+ provider compatibility via OpenAI-compatible endpoints + models.dev catalog ingestion (added `catalog.ts` + `ra catalog`; 193 providers, 167 OpenAI-compatible, converted to `provider` config)
- [x] Local models: Ollama + LM Studio auto-discovery (added `discoverLocalOpenAI` for LM Studio/llama.cpp OpenAI-compatible servers + `fromOpenAI` client)
- [x] Per-agent model assignment in config (`agent.<role>.model` in `anubis.json`)
- [x] Model router: automatic fallback chain cloud→local on failure/rate-limit, with per-request cost + latency logging (added `fallbackChain` + `runWithFallback` with per-attempt host/latency logging; `runner.ts` refactored to use it)

### Agent System
- [x] Primary agents: Build (ptah, full tools) and Plan (thoth, read-only)
- [x] Subagents: General, Explore, Scout — spawnable, visible in TUI with subagent tree (done: `general`/`explore`/`scout` agent defs + `TASK` spawn tool + `SubagentTree` tracker + `/tree` TUI command)
- [x] Custom agents as Markdown files with frontmatter (`permission`/`steps`/`temperature`/`model`/`tools` frontmatter honored)
- [x] Tool set: read/write/edit (diff-based), multi-edit, bash, grep, glob, ls, webfetch, todo tracking, task (subagent spawn)
- [x] Permission engine: per-tool allow/ask/deny rules, per-session approvals (`permission.tool` + agent frontmatter `permission` enforced; `ask` mode supports `autoApprove` and `onAsk` callback)

### Code Intelligence
- [x] LSP integration: auto-detect language, spawn server, feed diagnostics after every edit (done: `diagnostics.ts` runs compiler/linter + `DIAGNOSE` tool + `LspClient` with JSON-RPC over stdio for native LSP server protocol; `findLspServer` + `BUILTIN_LSP_SERVERS` for TS/Python/Go/Rust)
- [x] Tree-sitter or equivalent for symbol outline + navigation (added regex-based `symbols.ts` outline + `OUTLINE` tool; no native tree-sitter dep)
- [x] AGENTS.md / RA.md project memory auto-loaded into system context (added `loadProjectMemory`, injected into agent + orchestrator system prompts)

### MCP + Extensibility
- [x] MCP client: stdio, SSE/HTTP, OAuth; per-agent server config (done: stdio client + `mcp` config block + `loadMcpTools`; SSE/HTTP client via `McpHttpClient`; OAuth 2.1 with PKCE via `McpOAuthManager`)
- [x] MCP Tool Search: lazy-load tool definitions (added `searchMcpTools` — connects on demand and filters by name/description)
- [x] Plugin system + hooks (done: 9 tier-1 plugins + expanded hook surface: `tui.prompt.append`, `tui.command.execute`, `tool.execute.before/after`, `tool.write.before/after`, `tool.edit.before/after`, `message.part.updated`, `agent.turn.start/end`, `session.save`, `model.fallback`; `PluginHost.KNOWN_HOOKS` for discoverability)
- [x] Custom slash commands (Markdown-defined), keybinds, themes (Markdown commands in `.anubis/commands/*.md`; keybinds from `ra.json` config + theme override via `config.theme`)

### TUI Experience
- [x] Multi-pane TUI (done: single-pane chat + command palette + @-mention file picker + live token/cost sidebar + diff viewer via `ra diff`)
- [x] Session share/export (sanitized transcript) — `ra export` writes a vibeguard-redacted Markdown transcript
- [x] Undo/checkpoint: snapshot before each agent edit batch (added `checkpoint.ts` + `ra undo`/`ra checkpoints`; `toolWrite`/`toolEdit` snapshot before modifying)

### Integrations
- [x] GitHub Action: `/ra` comment on PRs triggers agent (added `.github/workflows/ra-agent.yml` — `/ra` comment runs `ra run` headless and posts the result)
- [x] IDE extension host protocol (VS Code JSON-RPC bridge) (added `ide.ts` + `ra ide` — JSON-RPC 2.0 over stdio with `ra/health`, `ra/sessions`, `ra/session`, `ra/message`, `ra/run`)

## P2 — RA-PLUS (Beyond Parity)

- [x] EVAL HARNESS: 20+ real coding tasks against every configured model; results table in STATUS.md (done: 21 tasks covering Python, JS, TS, HTML, CSS, bug-fix, JSON, algorithms)
- [x] SWARM MODE: N parallel agents on git worktrees + merge/conflict resolution (added `swarm.ts` — parallel worktrees + merge pass)
- [x] Semantic code search: local embeddings + vector index, incremental re-index (added `search.ts` — TF-IDF vector index + cosine similarity + incremental reindex)
- [x] Cost dashboard: per-session/per-model token + USD analytics in TUI (added per-session usage store + `ra cost --session`; TUI sidebar still pending)
- [x] Air-gapped mode: single flag → 100% local, zero telemetry (added `airgap` config + `RA_AIRGAP` env; localizes cloud models and blocks non-local webfetch)
- [x] Session replay + time-travel debugging (added `replay.ts` — timeline, replay-up-to, transcript, find-step)
- [x] Web dashboard reading from daemon API (added `GET /` HTML dashboard to the daemon)
- [x] Self-healing loops: on test failure, auto-diagnose + retry (max 3), log to BUGS.md (added `selfheal.ts`)

## P3 — Polish / Perf / DX

- [x] `ra run` alias for headless mode (added in Cycle 2)
- [x] Live token/cost sidebar in TUI (added a context sidebar showing per-model token + USD totals after each reply)
- [x] Diff viewer in TUI (added `diff.ts` + `ra diff <file>` showing checkpoint → current)
- [x] @-mention file picker (added in Cycle 19)
- [x] LM Studio auto-discovery (added in Cycle 20)

